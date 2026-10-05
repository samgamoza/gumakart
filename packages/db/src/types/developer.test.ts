import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WEBHOOK_MAX_ATTEMPTS,
  apiMoney,
  clampLimit,
  decodeCursor,
  encodeCursor,
  hasScope,
  nextWebhookAttempt,
  normalizeEvents,
  normalizeScopes,
  validateWebhookUrl,
} from "./developer";

describe("API scopes and events", () => {
  it("normalizes: canonical order, write implies read, unknown dropped", () => {
    assert.deepEqual(normalizeScopes(["inventory:write", "x", "orders:read", "orders:read"]), ["orders:read", "inventory:read", "inventory:write"]);
    assert.equal(hasScope(["orders:write"], "orders:read"), true);
    assert.equal(hasScope(["orders:read"], "orders:write"), false);
    assert.deepEqual(normalizeEvents(["customer.created", "order.created", "nope"]), ["order.created", "customer.created"]);
  });
});

describe("validateWebhookUrl", () => {
  it("accepts public https on the default port", () => {
    assert.deepEqual(validateWebhookUrl(" https://hooks.example.com/guma#x "), { ok: true, url: "https://hooks.example.com/guma" });
    assert.equal(validateWebhookUrl("https://hooks.zapier.com:443/hooks/catch/1/abc").ok, true);
  });
  it("rejects http, IPs, internal names, other ports, credentials and guma.one", () => {
    for (const bad of [
      "http://hooks.example.com",
      "https://10.0.0.5/x",
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "https://169.254.169.254/latest",
      "https://localhost/x",
      "https://printer.local/x",
      "https://intranet/x",
      "https://hooks.example.com:8443/x",
      "https://user:pw@hooks.example.com/x",
      "https://admin.guma.one/api/v1/orders",
      "not a url",
    ]) {
      assert.equal(validateWebhookUrl(bad).ok, false, bad);
    }
  });
  it("allows localhost only in dev mode", () => {
    assert.equal(validateWebhookUrl("http://localhost:3999/hook", { allowLocal: true }).ok, true);
    assert.equal(validateWebhookUrl("http://localhost:3999/hook").ok, false);
    assert.equal(validateWebhookUrl("http://10.0.0.1/hook", { allowLocal: true }).ok, false);
  });
});

describe("paging and money", () => {
  it("round-trips cursors and rejects junk", () => {
    const c = { t: "2026-10-05T01:02:03.456Z", i: "0b6f6a52-6d4c-4c3e-9a2e-0d1f5a7b9c11" };
    assert.deepEqual(decodeCursor(encodeCursor(c)), c);
    assert.equal(decodeCursor("garbage"), null);
    assert.equal(decodeCursor(encodeCursor({ t: "nope", i: c.i })), null);
    assert.equal(clampLimit("500"), 100);
    assert.equal(clampLimit("0"), 1);
    assert.equal(clampLimit(null), 50);
    assert.equal(apiMoney("682.3"), "682.30");
    assert.equal(apiMoney(null), "0.00");
  });
});

describe("webhook retries", () => {
  it("backs off and gives up after the last attempt", () => {
    const now = new Date("2026-10-05T00:00:00Z");
    assert.equal(nextWebhookAttempt(1, now)!.getTime() - now.getTime(), 60_000);
    assert.equal(nextWebhookAttempt(2, now)!.getTime() - now.getTime(), 5 * 60_000);
    assert.ok(nextWebhookAttempt(WEBHOOK_MAX_ATTEMPTS - 1, now));
    assert.equal(nextWebhookAttempt(WEBHOOK_MAX_ATTEMPTS, now), null);
  });
});
