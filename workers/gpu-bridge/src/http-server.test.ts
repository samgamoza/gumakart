import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { QueueEvents } from "bullmq";
import { CircuitBreaker } from "./circuit-breaker";
import { createHttpServer, signBody, TenantRateLimiter, verifySignature } from "./http-server";
import { nullLogger } from "./logger";

const SECRET = "s".repeat(40);
const TENANT = "11111111-1111-4111-8111-111111111111";
let outcome: () => Promise<unknown> = async () => ({ content: "Hi po!", toolCalls: [], model: "qwen3", usage: { promptTokens: 1, completionTokens: 2 }, finishReason: "stop" });
const llm = new CircuitBreaker({ name: "llm", failureThreshold: 1, cooldownMs: 60_000 });
const comfy = new CircuitBreaker({ name: "comfy", failureThreshold: 1, cooldownMs: 60_000 });
let added = 0;
const server = createHttpServer({
  secret: SECRET,
  queue: { add: (async () => { added += 1; return { waitUntilFinished: () => outcome() }; }) as never },
  events: {} as QueueEvents,
  breakers: { llm, comfy },
  waitMs: 1000,
  log: nullLogger,
  perTenantPerMinute: 5,
});
let base = "";
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const body = (tenantId = TENANT) => JSON.stringify({ kind: "chat", tenantId, purpose: "copywriter", request: { messages: [{ role: "user", content: "hm po?" }] } });
async function post(b: string, opts: { ts?: number; sig?: string | null } = {}) {
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { "content-type": "application/json", "x-guma-timestamp": String(ts) };
  if (opts.sig !== null) headers["x-guma-signature"] = opts.sig ?? signBody(SECRET, ts, b);
  const res = await fetch(`${base}/v1/realtime/chat`, { method: "POST", headers, body: b });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("bridge HTTP endpoint", () => {
  it("signature check: ok / missing / stale / tampered", () => {
    const ts = 1_800_000_000;
    assert.equal(verifySignature(SECRET, String(ts), signBody(SECRET, ts, "x"), "x", ts + 10), "ok");
    assert.equal(verifySignature(SECRET, undefined, "v1=00", "x", ts), "missing");
    assert.equal(verifySignature(SECRET, String(ts), signBody(SECRET, ts, "x"), "x", ts + 301), "stale");
    assert.equal(verifySignature(SECRET, String(ts), signBody(SECRET, ts, "x"), "y", ts), "bad");
    assert.equal(verifySignature("other".repeat(10), String(ts), signBody(SECRET, ts, "x"), "x", ts), "bad");
  });

  it("serves signed requests and rejects everything else before queueing", async () => {
    const before = added;
    const ok = await post(body());
    assert.equal(ok.status, 200);
    assert.equal(ok.json.servedBy, "gpu-node");
    assert.equal(ok.json.content, "Hi po!");
    assert.equal((await post(body(), { sig: null })).status, 401);
    assert.equal((await post(body(), { sig: signBody(SECRET, 1, body()) })).status, 401);
    assert.equal((await post(body(), { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
    assert.equal((await post("{not json")).status, 400);
    assert.equal((await post(JSON.stringify({ kind: "chat", tenantId: "nope" }))).status, 400);
    assert.equal((await post("x".repeat(300 * 1024))).status, 413);
    assert.equal(added - before, 1, "only the valid request reached the queue");
  });

  it("maps node-down / timeout / breaker-open to codes the app falls back on", async () => {
    const t2 = "22222222-2222-4222-8222-222222222222";
    outcome = async () => { throw new Error("GPU_NODE_UNAVAILABLE: circuit open"); };
    assert.deepEqual([await post(body(t2))].map((r) => [r.status, r.json.code]), [[503, "GPU_NODE_UNAVAILABLE"]]);
    outcome = async () => { throw new Error("Job wait chat timed out before finishing"); };
    assert.equal((await post(body(t2))).status, 504);
    llm.onFailure();
    const before = added;
    const open = await post(body(t2));
    assert.deepEqual([open.status, open.json.code], [503, "GPU_NODE_UNAVAILABLE"]);
    assert.equal(added, before, "breaker open → not queued at all");
    llm.onSuccess();
  });

  it("rate limits per shop and exposes health", async () => {
    const t3 = "33333333-3333-4333-8333-333333333333";
    outcome = async () => ({ content: "ok", toolCalls: [], model: "q", usage: { promptTokens: 0, completionTokens: 0 }, finishReason: null });
    const codes = [];
    for (let i = 0; i < 6; i += 1) codes.push((await post(body(t3))).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
    const health = (await (await fetch(`${base}/healthz`)).json()) as Record<string, unknown>;
    assert.deepEqual(health, { ok: true, llm: "closed", comfy: "closed" });
    assert.equal((await fetch(`${base}/v1/realtime/chat`)).status, 405);
    let t = 0;
    const lim = new TenantRateLimiter(2, () => t);
    assert.deepEqual([lim.allow("a"), lim.allow("a"), lim.allow("a"), lim.allow("b")], [true, true, false, true]);
    t = 60_000;
    assert.equal(lim.allow("a"), true, "window resets");
  });
});
