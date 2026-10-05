import assert from "node:assert/strict";
import { test } from "node:test";
import { sendWebhook, signWebhookPayload, verifyWebhookSignature } from "./sign";

test("webhook signatures", async (t0) => {
  await t0.test("signs t.body with HMAC-SHA256 and verifies within 5 minutes", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "order.paid" });
    const header = await signWebhookPayload("whsec_test", body, 1_800_000_000);
    assert.match(header, /^t=1800000000,v1=[0-9a-f]{64}$/);
    assert.equal(await verifyWebhookSignature("whsec_test", body, header, { nowSec: 1_800_000_100 }), true);
    assert.equal(await verifyWebhookSignature("whsec_other", body, header, { nowSec: 1_800_000_100 }), false);
    assert.equal(await verifyWebhookSignature("whsec_test", `${body} `, header, { nowSec: 1_800_000_100 }), false);
    assert.equal(await verifyWebhookSignature("whsec_test", body, header, { nowSec: 1_800_000_400 }), false, "too old");
    assert.equal(await verifyWebhookSignature("whsec_test", body, null), false);
  });

  await t0.test("sendWebhook: 2xx delivers, 3xx/5xx/network fail with a reason", async () => {
    let seen: { headers: Headers; body: string } | null = null;
    const ok = await sendWebhook({
      url: "https://hooks.example.com/guma",
      secret: "whsec_test",
      body: "{\"a\":1}",
      event: "order.created",
      eventId: "e1",
      deliveryId: "d1",
      attempt: 1,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen = { headers: new Headers(init.headers), body: String(init.body) };
        assert.equal(init.redirect, "manual");
        return new Response("ok", { status: 200 });
      }) as unknown as typeof fetch,
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.statusCode, 200);
    const s = seen as unknown as { headers: Headers; body: string };
    assert.equal(s.headers.get("guma-event"), "order.created");
    assert.equal(s.headers.get("guma-delivery"), "d1");
    assert.equal(await verifyWebhookSignature("whsec_test", s.body, s.headers.get("guma-signature")), true);

    const redirect = await sendWebhook({ url: "https://x.example.com", secret: "s", body: "{}", event: "e", eventId: "e", deliveryId: "d", attempt: 1, fetchImpl: (async () => new Response(null, { status: 301 })) as unknown as typeof fetch });
    assert.equal(redirect.ok, false);
    assert.match(redirect.error ?? "", /Redirects/);

    const err = await sendWebhook({ url: "https://x.example.com", secret: "s", body: "{}", event: "e", eventId: "e", deliveryId: "d", attempt: 1, fetchImpl: (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch });
    assert.equal(err.ok, false);
    assert.equal(err.error, "HTTP 500: boom");

    const down = await sendWebhook({ url: "https://x.example.com", secret: "s", body: "{}", event: "e", eventId: "e", deliveryId: "d", attempt: 1, fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    assert.equal(down.ok, false);
    assert.equal(down.statusCode, null);
    assert.match(down.error ?? "", /Couldn't connect/);
  });
});
