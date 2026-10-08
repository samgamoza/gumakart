import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { PayMongoClient, parsePayMongoPaymentEvent } from "./paymongo";
import { startOnlinePayment } from "./adapter";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("checkout session: hosted page, one line item, intent id as the payment key", async () => {
  const captured: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    captured.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(
      JSON.stringify({
        data: {
          id: "cs_123",
          attributes: { checkout_url: "https://checkout.paymongo.com/cs_123", payment_intent: { id: "pi_456" } },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const client = new PayMongoClient("sk_test_real_looking_key");
  const result = await client.createCheckoutSession({
    amountCentavos: 125000,
    lineItemName: "Order 0007 — Tita Bea",
    description: "Order 0007",
    methods: ["gcash"],
    referenceNumber: "0007",
    successUrl: "https://kart.guma.one/tita/orders/0007?t=abc&paid=1",
    cancelUrl: "https://kart.guma.one/tita/orders/0007?t=abc",
  });

  assert.equal(result.checkoutUrl, "https://checkout.paymongo.com/cs_123");
  assert.equal(result.paymentIntentId, "pi_456");
  const sent = captured[0];
  assert.ok(sent);
  assert.equal(sent!.url, "https://api.paymongo.com/v1/checkout_sessions");
  const a = sent!.body.data.attributes;
  assert.deepEqual(a.payment_method_types, ["gcash"]);
  assert.equal(a.line_items[0].amount, 125000);
  assert.equal(a.line_items[0].quantity, 1);
  assert.equal(a.reference_number, "0007");
  assert.match(a.success_url, /paid=1/);
});

test("startOnlinePayment sends the buyer back to the tokenized order page", async () => {
  let body: any = null;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ data: { id: "cs_9", attributes: { checkout_url: "https://checkout.paymongo.com/cs_9" } } }),
      { status: 200 }
    );
  }) as typeof fetch;
  const saved = process.env.PAYMONGO_SECRET_KEY;
  process.env.PAYMONGO_SECRET_KEY = "sk_test_real_looking_key";
  try {
    const started = await startOnlinePayment({
      amountCentavos: 5000,
      description: "Order 1",
      method: "qrph",
      metadata: {},
      returnUrl: "https://kart.guma.one/s/orders/1?t=tok",
      referenceNumber: "1",
      lineItemName: "Order 1",
    });
    assert.equal(started.redirectUrl, "https://checkout.paymongo.com/cs_9");
    assert.equal(started.paymentIntentId, "cs_9", "falls back to the session id");
    assert.equal(body.data.attributes.success_url, "https://kart.guma.one/s/orders/1?t=tok&paid=1");
    assert.equal(body.data.attributes.cancel_url, "https://kart.guma.one/s/orders/1?t=tok");
  } finally {
    if (saved === undefined) delete process.env.PAYMONGO_SECRET_KEY;
    else process.env.PAYMONGO_SECRET_KEY = saved;
  }
});

test("webhook parsing: hosted checkout and plain payment events", () => {
  const cs = parsePayMongoPaymentEvent({
    data: {
      attributes: {
        type: "checkout_session.payment.paid",
        data: {
          id: "cs_1",
          attributes: { payment_intent: { id: "pi_1" }, payments: [{ id: "pay_1", attributes: { amount: 12345, currency: "PHP" } }] },
        },
      },
    },
  });
  // Security G2 (GK-16): the paid amount and currency ride along so the webhook can check them.
  assert.deepEqual(cs, { type: "checkout_session.payment.paid", sessionId: "cs_1", intentId: "pi_1", paymentId: "pay_1", amountCentavos: 12345, currency: "PHP" });

  const paid = parsePayMongoPaymentEvent({
    data: { attributes: { type: "payment.paid", data: { id: "pay_2", attributes: { payment_intent_id: "pi_2", amount: 500, currency: "PHP" } } } },
  });
  assert.deepEqual(paid, { type: "payment.paid", intentId: "pi_2", paymentId: "pay_2", amountCentavos: 500, currency: "PHP" });

  assert.equal(parsePayMongoPaymentEvent({ nope: true }), null);
});
