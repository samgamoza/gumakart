import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gpuNodeHeaders, loadConfig } from "./config";

const base = { DATABASE_URL: "postgres://x", REDIS_URL: "redis://localhost:6379", GPU_BRIDGE_SECRET: "x".repeat(32) };

describe("loadConfig", () => {
  it("applies defaults from IMPLEMENTATION_PLAN", () => {
    const cfg = loadConfig({ ...base, MEDIA_STORAGE_DRIVER: "local" });
    assert.equal(cfg.LLM_BASE_URL, "https://llm-node.guma.one/v1");
    assert.equal(cfg.COMFY_BASE_URL, "https://gpu-node.guma.one");
    assert.equal(cfg.BATCH_CONCURRENCY, 1);
    assert.equal(cfg.ENABLE_BATCH, true);
  });

  it("rejects missing essentials with a readable message", () => {
    assert.throws(() => loadConfig({}), /DATABASE_URL[\s\S]*REDIS_URL/);
    assert.throws(() => loadConfig({ ...base }), /MEDIA_STORAGE_DRIVER=s3 needs MEDIA_S3_ENDPOINT/);
    assert.doesNotThrow(() => loadConfig({ ...base, ENABLE_BATCH: "false" }), "realtime-only node needs no bucket");
  });

  it("the HTTP endpoint refuses to start without a strong shared secret", () => {
    assert.throws(() => loadConfig({ ...base, MEDIA_STORAGE_DRIVER: "local", GPU_BRIDGE_SECRET: "short" }), /GPU_BRIDGE_SECRET/);
    assert.doesNotThrow(() => loadConfig({ ...base, MEDIA_STORAGE_DRIVER: "local", GPU_BRIDGE_SECRET: undefined, ENABLE_HTTP: "false" }));
  });

  it("adds Cloudflare Access headers only when both parts are set", () => {
    assert.deepEqual(gpuNodeHeaders({ CF_ACCESS_CLIENT_ID: "a" }), {});
    assert.deepEqual(gpuNodeHeaders({ CF_ACCESS_CLIENT_ID: "a", CF_ACCESS_CLIENT_SECRET: "b" }), { "CF-Access-Client-Id": "a", "CF-Access-Client-Secret": "b" });
  });
});
