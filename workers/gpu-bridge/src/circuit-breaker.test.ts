import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CircuitBreaker, GpuNodeUnavailableError, HttpError, isNodeFailure } from "./circuit-breaker";

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("CircuitBreaker", () => {
  it("opens after N consecutive failures, half-opens after cooldown, closes on probe success", () => {
    const c = clock();
    const changes: string[] = [];
    const b = new CircuitBreaker({ name: "comfy", failureThreshold: 3, cooldownMs: 10_000, now: c.now, onStateChange: (_n, f, t) => changes.push(`${f}->${t}`) });
    b.onFailure();
    b.onFailure();
    assert.equal(b.currentState, "closed");
    b.onSuccess(); // success resets the streak
    b.onFailure();
    b.onFailure();
    assert.equal(b.currentState, "closed");
    b.onFailure();
    assert.equal(b.currentState, "open");
    assert.equal(b.canRequest(), false);
    assert.equal(b.retryInMs, 10_000);
    c.advance(10_000);
    assert.equal(b.currentState, "half_open");
    assert.equal(b.canRequest(), true, "one probe allowed");
    assert.equal(b.canRequest(), false, "only one probe at a time");
    b.onSuccess();
    assert.equal(b.currentState, "closed");
    assert.deepEqual(changes, ["closed->open", "open->half_open", "half_open->closed"]);
  });

  it("a failed probe re-opens immediately for a full cooldown", () => {
    const c = clock();
    const b = new CircuitBreaker({ name: "llm", failureThreshold: 1, cooldownMs: 5_000, now: c.now });
    b.onFailure();
    c.advance(5_000);
    assert.equal(b.canRequest(), true);
    b.onFailure();
    assert.equal(b.currentState, "open");
    assert.equal(b.retryInMs, 5_000);
  });

  it("run(): refuses while open, counts only node failures", async () => {
    const b = new CircuitBreaker({ name: "comfy", failureThreshold: 1, cooldownMs: 60_000 });
    await assert.rejects(b.run(async () => { throw new HttpError(400, "/prompt", "bad graph"); }, isNodeFailure), HttpError);
    assert.equal(b.currentState, "closed", "a 400 means the node is up");
    await assert.rejects(b.run(async () => { throw new HttpError(530, "/prompt", "tunnel down"); }, isNodeFailure), HttpError);
    assert.equal(b.currentState, "open");
    let called = false;
    await assert.rejects(b.run(async () => { called = true; }), GpuNodeUnavailableError);
    assert.equal(called, false);
  });

  it("classifies node failures", () => {
    assert.equal(isNodeFailure(new HttpError(502, "u", "")), true);
    assert.equal(isNodeFailure(new HttpError(530, "u", "")), true, "Cloudflare tunnel offline");
    assert.equal(isNodeFailure(new HttpError(429, "u", "")), true);
    assert.equal(isNodeFailure(new HttpError(404, "u", "")), false);
    assert.equal(isNodeFailure(Object.assign(new Error("aborted"), { name: "TimeoutError" })), true);
    assert.equal(isNodeFailure(new TypeError("fetch failed")), true);
    assert.equal(isNodeFailure(new Error("connect ECONNREFUSED 127.0.0.1:8188")), true);
    assert.equal(isNodeFailure(new Error("validation failed")), false);
  });
});
