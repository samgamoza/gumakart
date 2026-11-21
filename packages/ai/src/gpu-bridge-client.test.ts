import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { BridgeRejectedError, BridgeUnavailableError, bridgeConfigFromEnv, callBridgeChat, runLocalFirst, signBridgeRequest, type GpuBridgeConfig } from "./gpu-bridge-client";

const SECRET = "k".repeat(40);
const req = { tenantId: "11111111-1111-4111-8111-111111111111", purpose: "copywriter" as const, messages: [{ role: "user" as const, content: "hi" }] };
function cfg(handler: (init: RequestInit) => Response | Promise<Response>, timeoutMs = 2000): GpuBridgeConfig {
  return { url: "https://bridge.example", secret: SECRET, timeoutMs, fetch: (async (_u: unknown, init?: RequestInit) => handler(init ?? {})) as typeof fetch };
}
const okBody = { ok: true, servedBy: "gpu-node", content: "Hi po!", model: "qwen3-235b", toolCalls: [], usage: { promptTokens: 3, completionTokens: 4 }, finishReason: "stop" };

describe("GPU bridge client", () => {
  it("signs exactly like the bridge verifies (Web Crypto == node:crypto)", async () => {
    const h = await signBridgeRequest(SECRET, '{"a":1}', 1_800_000_000);
    const expected = createHmac("sha256", SECRET).update('1800000000.{"a":1}').digest("hex");
    assert.deepEqual(h, { "x-guma-timestamp": "1800000000", "x-guma-signature": `v1=${expected}` });
  });

  it("sends a signed body with the realtime job shape and reads the answer", async () => {
    let sent: { headers: Record<string, string>; body: string } | undefined;
    const r = await callBridgeChat(
      { ...cfg((init) => { sent = { headers: init.headers as Record<string, string>, body: String(init.body) }; return Response.json(okBody); }), cfAccessClientId: "id", cfAccessClientSecret: "sec" },
      { ...req, maxTokens: 50, responseFormat: { type: "json_object" } }
    );
    assert.equal(r.content, "Hi po!");
    const body = JSON.parse(sent!.body);
    assert.deepEqual(body, { kind: "chat", tenantId: req.tenantId, purpose: "copywriter", request: { messages: req.messages, maxTokens: 50, responseFormat: { type: "json_object" } } });
    const ts = sent!.headers["x-guma-timestamp"]!;
    assert.equal(sent!.headers["x-guma-signature"], `v1=${createHmac("sha256", SECRET).update(`${ts}.${sent!.body}`).digest("hex")}`);
    assert.equal(sent!.headers["CF-Access-Client-Id"], "id");
  });

  it("classifies tunnel-down / timeouts as unavailable, refusals as rejected", async () => {
    await assert.rejects(callBridgeChat(cfg(() => new Response("<html>Cloudflare Tunnel error</html>", { status: 530 })), req), (e: unknown) => e instanceof BridgeUnavailableError && e.status === 530);
    await assert.rejects(callBridgeChat(cfg(() => Response.json({ ok: false, code: "GPU_NODE_UNAVAILABLE" }, { status: 503 })), req), (e: unknown) => e instanceof BridgeUnavailableError && e.code === "GPU_NODE_UNAVAILABLE");
    const slow = cfg(
      (init) =>
        new Promise<Response>((resolve, reject) => {
          const t = setTimeout(() => resolve(Response.json(okBody)), 300);
          init.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(init.signal!.reason);
          });
        }),
      50
    );
    await assert.rejects(callBridgeChat(slow, req), /timed out/);
    await assert.rejects(callBridgeChat(cfg(() => { throw new TypeError("fetch failed"); }), req), BridgeUnavailableError);
    await assert.rejects(callBridgeChat(cfg(() => Response.json({ ok: false }, { status: 401 })), req), (e: unknown) => e instanceof BridgeRejectedError && e.status === 401);
  });

  it("runLocalFirst: GPU node when healthy, cloud otherwise — never throws the bridge error", async () => {
    const cloud = async () => "cloud-answer";
    const reasons: string[] = [];
    const onFallback = (r: string) => reasons.push(r);
    const healthy = await runLocalFirst({ bridge: cfg(() => Response.json(okBody)), request: req, fromBridge: (r) => r.content, cloud, onFallback });
    assert.deepEqual(healthy, { result: "Hi po!", servedBy: "gpu-node" });
    assert.equal((await runLocalFirst({ bridge: cfg(() => new Response("", { status: 530 })), request: req, fromBridge: (r) => r.content, cloud, onFallback })).servedBy, "cloud");
    assert.equal((await runLocalFirst({ bridge: null, request: req, fromBridge: (r) => r.content, cloud, onFallback })).fallbackReason, "not_configured");
    assert.equal((await runLocalFirst({ bridge: cfg(() => Response.json(okBody)), request: req, fromBridge: () => null, cloud, onFallback })).fallbackReason, "unusable_answer");
    assert.equal((await runLocalFirst({ bridge: cfg(() => Response.json({}, { status: 401 })), request: req, fromBridge: (r) => r.content, cloud, onFallback })).fallbackReason, "rejected_401");
    assert.deepEqual(reasons, ["unavailable", "not_configured", "unusable_answer", "rejected_401"]);
  });

  it("reads config from env only when URL and secret are both set", () => {
    assert.equal(bridgeConfigFromEnv({ GPU_BRIDGE_URL: "https://b.example" }), null);
    assert.deepEqual(bridgeConfigFromEnv({ GPU_BRIDGE_URL: "https://b.example/", GPU_BRIDGE_SECRET: "s", GPU_BRIDGE_TIMEOUT_MS: "9000" }), {
      url: "https://b.example",
      secret: "s",
      timeoutMs: 9000,
      cfAccessClientId: undefined,
      cfAccessClientSecret: undefined,
    });
  });
});
