import assert from "node:assert/strict";
import { test } from "node:test";
import {
  abandonedCheckoutSms,
  deliveredSms,
  isQuietHours,
  isRecipeEnabled,
  orderCreatedSms,
  outForDeliverySms,
  paymentConfirmedSms,
  readyForPickupSms,
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
