import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it, test } from "node:test";
import { verifyGrabWebhook, verifyTimestampedHmacSignature, webhookTimestampFresh } from "./webhook-signature";

describe("courier webhook HMAC", () => {
  const secret = "grab_webhook_secret";
  const rawBody = JSON.stringify({ deliveryID: "del_1", status: "COMPLETED" });
  const timestamp = Math.floor(Date.now() / 1000);

  it("accepts a matching signature", () => {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    assert.equal(
      verifyTimestampedHmacSignature({ rawBody, signature, timestamp, secret }),
      true
    );
  });

  it("rejects a bad signature", () => {
    assert.equal(
      verifyTimestampedHmacSignature({
        rawBody,
        signature: "deadbeef",
        timestamp,
        secret,
      }),
      false
    );
  });

  it("rejects empty secret", () => {
    assert.equal(
      verifyTimestampedHmacSignature({
        rawBody,
        signature: "abc",
        timestamp,
        secret: "",
      }),
      false
    );
  });
});

/* Security G2 (GK-19): courier webhooks reject stale events; Grab's signature can actually verify. */
test("webhook timestamps: fresh in seconds, ms or ISO; stale after 5 minutes", () => {
  const now = Date.now();
  assert.equal(webhookTimestampFresh(Math.floor(now / 1000), undefined, now), true);
  assert.equal(webhookTimestampFresh(now - 60_000, undefined, now), true);
  assert.equal(webhookTimestampFresh(new Date(now).toISOString(), undefined, now), true);
  assert.equal(webhookTimestampFresh(now - 6 * 60_000, undefined, now), false);
  assert.equal(webhookTimestampFresh(now + 6 * 60_000, undefined, now), false);
  assert.equal(webhookTimestampFresh("", undefined, now), false);
  assert.equal(webhookTimestampFresh("yesterday", undefined, now), false);
});

test("Grab: a body-carried signature verifies over the body without itself; headers verify over the raw body", () => {
  const secret = "s3cret";
  const ts = Date.now();
  const payload = { deliveryID: "d1", status: "COMPLETED", timestamp: ts };
  const sig = createHmac("sha256", secret).update(`${ts}.${JSON.stringify(payload)}`).digest("hex");
  const body = { ...payload, signature: sig };
  const rawBody = JSON.stringify(body);
  const noHeaders = { get: () => null };
  assert.equal(verifyGrabWebhook({ rawBody, headers: noHeaders, body, secret }).ok, true);
  assert.equal(verifyGrabWebhook({ rawBody, headers: noHeaders, body: { ...body, status: "CANCELED" }, secret }).ok, false);
  assert.equal(verifyGrabWebhook({ rawBody, headers: noHeaders, body: { ...body, timestamp: ts - 10 * 60_000 }, secret }).reason, "stale timestamp");

  const raw2 = JSON.stringify(payload);
  const hsig = createHmac("sha256", secret).update(`${ts}.${raw2}`).digest("hex");
  const headers = { get: (n: string) => (n === "x-grab-signature" ? hsig : n === "x-grab-timestamp" ? String(ts) : null) };
  assert.equal(verifyGrabWebhook({ rawBody: raw2, headers, body: payload, secret }).ok, true);
  assert.equal(verifyGrabWebhook({ rawBody: raw2 + " ", headers, body: payload, secret }).ok, false);
});
