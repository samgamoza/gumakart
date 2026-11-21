import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError } from "./circuit-breaker";
import { collectOutputs, ComfyClient, ComfyExecutionError, ComfyTimeoutError, guessContentType, mediaKind } from "./comfy-client";
import { isComfyWorkflow } from "./workflows";
import { stripThinking } from "./llm-client";

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function client(handler: Handler, extra: { now?: () => number } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { calls, c: new ComfyClient({ baseUrl: "https://gpu-node.example/", headers: { "CF-Access-Client-Id": "id" }, fetch: fetchImpl, sleep: async () => {}, ...extra }) };
}

describe("ComfyClient", () => {
  it("submits, polls history until done, and collects outputs", async () => {
    let polls = 0;
    let sentHeaders: Record<string, string> = {};
    const { c, calls } = client((url, init) => {
      if (url.pathname === "/prompt") {
        sentHeaders = init.headers as Record<string, string>;
        const body = JSON.parse(String(init.body));
        assert.equal(body.client_id, "job-1");
        assert.ok(body.prompt["9"]);
        return json({ prompt_id: "p-1", number: 3, node_errors: {} });
      }
      if (url.pathname === "/history/p-1") {
        polls += 1;
        if (polls < 3) return json({});
        return json({
          "p-1": {
            status: { status_str: "success", completed: true, messages: [] },
            outputs: {
              "9": { images: [{ filename: "studio_00001_.png", subfolder: "", type: "output" }, { filename: "prev.png", subfolder: "", type: "temp" }] },
              "12": { gifs: [{ filename: "ad_00001.mp4", subfolder: "video", type: "output", format: "video/h264-mp4" }] },
            },
          },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const id = await c.submit({ "9": { class_type: "SaveImage", inputs: {} } }, "job-1");
    assert.equal(id, "p-1");
    assert.equal(sentHeaders["CF-Access-Client-Id"], "id");
    let ticks = 0;
    const files = await c.waitForOutputs("p-1", { intervalMs: 1, timeoutMs: 60_000, onTick: () => void (ticks += 1) });
    assert.equal(ticks, 2);
    assert.deepEqual(files.map((f) => `${f.field}:${f.subfolder}/${f.filename}`), ["images:/studio_00001_.png", "gifs:video/ad_00001.mp4"]);
    assert.equal(calls.filter((x) => x.startsWith("GET /history")).length, 3);
  });

  it("surfaces execution errors and node_errors", async () => {
    const { c } = client((url) =>
      url.pathname === "/prompt"
        ? json({ error: "invalid", node_errors: { "3": "missing model flux1-dev.safetensors" } })
        : json({ "p-2": { status: { status_str: "error", completed: false, messages: [["execution_error", { node_type: "KSampler", exception_message: "CUDA out of memory" }]] } } })
    );
    await assert.rejects(c.submit({ "1": { class_type: "X", inputs: {} } }, "j"), (e: unknown) => e instanceof ComfyExecutionError && /flux1-dev/.test(e.message));
    await assert.rejects(c.waitForOutputs("p-2", { intervalMs: 1, timeoutMs: 1000 }), (e: unknown) => e instanceof ComfyExecutionError && /KSampler: CUDA out of memory/.test(e.message));
  });

  it("times out and propagates HTTP errors", async () => {
    let t = 0;
    const { c } = client(() => json({}), { now: () => (t += 10_000) });
    await assert.rejects(c.waitForOutputs("p-3", { intervalMs: 1, timeoutMs: 25_000 }), ComfyTimeoutError);
    const down = client(() => new Response("tunnel offline", { status: 530 })).c;
    await assert.rejects(down.ping(), (e: unknown) => e instanceof HttpError && e.status === 530);
  });

  it("downloads via /view with the right query", async () => {
    const { c, calls } = client(() => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));
    const out = await c.download({ nodeId: "9", field: "images", filename: "a b.png", subfolder: "x", type: "output" });
    assert.deepEqual([...out.bytes], [1, 2, 3]);
    assert.equal(calls[0], "GET /view?filename=a+b.png&subfolder=x&type=output");
  });

  it("helpers", () => {
    assert.equal(collectOutputs({ "1": { text: ["hello"], images: [{ filename: "x.webp" }] } }).length, 1);
    assert.equal(guessContentType("A.MP4"), "video/mp4");
    assert.equal(mediaKind("audio/wav"), "audio");
    assert.equal(isComfyWorkflow({ "1": { class_type: "LoadImage", inputs: { image: "x.png" } } }), true);
    assert.equal(isComfyWorkflow({}), false);
    assert.equal(isComfyWorkflow([{ class_type: "x", inputs: {} }]), false);
    assert.equal(stripThinking("<think>internal plan</think>\nHi po! ₱299 lang."), "Hi po! ₱299 lang.");
  });
});
