import assert from "node:assert/strict";
import { test } from "node:test";
import {
  abandonedCheckoutSms,
  backInStockSms,
  deliveredSms,
  isQuietHours,
  isRecipeEnabled,
  orderCreatedSms,
  outForDeliverySms,
  paymentConfirmedSms,
  readyForPickupSms,
  reviewRequestSms,
  sellerNewOrderSms,
  smsPeso,
  smsShopName,
  unpaidReminderSms,
} from "./recipes";

const base = {
  shopName: "Tess Lifestyle PH",
  orderNumber: "TES-0001",
  total: "2077.00",
  paymentMethod: "gcash",
  deliveryType: "delivery",
  orderUrl: "https://kart.guma.one/tess/orders/TES-0001?t=abc",
};

const ascii = (s: string) => /^[\x20-\x7E]*$/.test(s);

test("peso is ASCII and drops zero centavos", () => {
  assert.equal(smsPeso("2077.00"), "P2,077");
  assert.equal(smsPeso(99.5), "P99.50");
  assert.equal(smsPeso("x"), "P0");
});

test("shop name is ASCII-folded and capped", () => {
  assert.equal(smsShopName("Niña's Café ✨"), "Nina's Cafe");
  assert.ok(smsShopName("A".repeat(50)).length <= 30);
  assert.equal(smsShopName("✨✨"), "Your shop");
});

test("every buyer text starts with the shop and stays ASCII", () => {
  const texts = [
    orderCreatedSms(base),
    orderCreatedSms({ ...base, paymentMethod: "cod" }),
    orderCreatedSms({ ...base, paymentMethod: "cod", deliveryType: "pickup" }),
    paymentConfirmedSms(base),
    readyForPickupSms({ ...base, deliveryType: "pickup", pickupAddress: "Blk 1 Lot 2, Quezon City", codDue: true }),
    outForDeliverySms({ ...base, codDue: true }),
    deliveredSms(base),
    abandonedCheckoutSms({ shopName: base.shopName, productTitle: "Wireless Headphones", url: "https://kart.guma.one/c/abc1234", step: 1 }),
    unpaidReminderSms(base),
  ];
  for (const t of texts) {
    assert.ok(t.startsWith("Tess Lifestyle PH: "), t);
    assert.ok(ascii(t), t);
  }
});

test("COD amount only when due", () => {
  assert.match(outForDeliverySms({ ...base, codDue: true }), /Pakihanda ang P2,077 cash/);
  assert.doesNotMatch(outForDeliverySms({ ...base, codDue: false }), /Pakihanda/);
});

test("e-wallet order text names the wallet and links the order page", () => {
  const t = orderCreatedSms(base);
  assert.match(t, /GCash/);
  assert.ok(t.includes(base.orderUrl));
});

test("abandoned steps differ", () => {
  const a = abandonedCheckoutSms({ shopName: "S", url: "u", step: 1 });
  const b = abandonedCheckoutSms({ shopName: "S", url: "u", step: 2 });
  assert.notEqual(a, b);
});

test("seller alert", () => {
  assert.match(sellerNewOrderSms({ orderNumber: "X-1", total: 100, paymentMethod: "cod", buyerName: "Ana" }), /Bagong order #X-1 - P100 \(COD\) mula kay Ana/);
});

test("quiet hours are 9 PM to 8 AM Manila", () => {
  assert.equal(isQuietHours(new Date("2026-10-04T13:30:00Z")), true); // 21:30 MNL
  assert.equal(isQuietHours(new Date("2026-10-04T23:59:00Z")), true); // 07:59 MNL
  assert.equal(isQuietHours(new Date("2026-10-04T00:00:00Z")), false); // 08:00 MNL
  assert.equal(isQuietHours(new Date("2026-10-04T12:59:00Z")), false); // 20:59 MNL
});

test("recipes default on", () => {
  assert.equal(isRecipeEnabled(undefined, "delivered"), true);
  assert.equal(isRecipeEnabled({ delivered: false }, "delivered"), false);
});

test("POS receipt text", async () => {
  const { posReceiptSms } = await import("./recipes");
  const t = posReceiptSms({
    shopName: "Tindahan ni Aling Nena",
    orderNumber: "TIN-0042",
    createdAt: "2026-10-04T03:15:00Z",
    items: [
      { title: "Sabon", quantity: 2, lineTotal: 90 },
      { title: "Kape 3-in-1", quantity: 1, lineTotal: 12 },
    ],
    totals: { total: 102, discountAmount: 0 },
    change: 98,
  });
  assert.match(t, /^Tindahan ni Aling Nena receipt #TIN-0042/);
  assert.match(t, /2x Sabon P90; 1x Kape 3-in-1 P12\. Total P102\. Sukli P98\. Salamat!$/);
  assert.ok(/^[\x20-\x7E]*$/.test(t));
});

test("Phase 14 campaign texts", async (t0) => {
  await t0.test("prefixes the shop, personalises, folds to ASCII and appends the link", async () => {
    const { campaignSms, smsSegments } = await import("./recipes");
    const t = campaignSms({ shopName: "Tess Lifestyle PH", body: "Hi {name}! ₱100 off 🎉 today", buyerName: "Ana Reyes", link: "https://kart.guma.one/tess?ref=sms" });
    assert.equal(t, "Tess Lifestyle PH: Hi Ana! P100 off today https://kart.guma.one/tess?ref=sms");
    assert.match(campaignSms({ shopName: "S", body: "Hello {NAME}" }), /Hello po$/);
    assert.equal(smsSegments("a".repeat(160)), 1);
    assert.equal(smsSegments("a".repeat(161)), 2);
  });
});

test("Phase 23: review request is ASCII, carries the order link, and is opt-in", () => {
  const body = reviewRequestSms(base);
  assert.ok(ascii(body), body);
  assert.ok(body.startsWith("Tess Lifestyle PH:"));
  assert.ok(body.includes(base.orderUrl));
  assert.equal(isRecipeEnabled({}, "review_request"), false);
  assert.equal(isRecipeEnabled({ review_request: true }, "review_request"), true);
  assert.equal(isRecipeEnabled({}, "delivered"), true, "others stay on by default");
});

test("Phase 22: back-in-stock text is ASCII with the shop name and link", () => {
  const body = backInStockSms({ shopName: "Tess Lifestyle PH", productTitle: "Piña Tote ✨", variantTitle: "Small", url: "https://kart.guma.one/tess/products/tote" });
  assert.ok(ascii(body), body);
  assert.ok(body.startsWith("Tess Lifestyle PH: May stock na ulit ang Pina Tote"));
  assert.ok(body.includes("(Small)"));
  assert.ok(body.endsWith("https://kart.guma.one/tess/products/tote"));
});
