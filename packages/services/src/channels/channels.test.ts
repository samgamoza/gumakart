/**
 * Phase 13 — channel helpers that don't need a network: Meta webhook parsing + signature,
 * message payloads, marketplace signing, token sealing, buyer email templates.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { metaMessagePayload, parseMetaWebhook, verifyMetaSignature } from "./meta";
import { lazadaSign, listingKey, shopeeSign } from "./marketplaces";
import { openToken, sealToken } from "../crypto/token-box";
import { isEmailAddress, orderEmail, posReceiptEmail } from "../messaging/email-templates";

describe("Meta webhook", () => {
  it("checks X-Hub-Signature-256", async () => {
    const body = JSON.stringify({ object: "page", entry: [] });
    const good = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    assert.equal(await verifyMetaSignature(body, good, "s3cret"), true);
    assert.equal(await verifyMetaSignature(body, good, "other"), false);
    assert.equal(await verifyMetaSignature(`${body} `, good, "s3cret"), false);
    assert.equal(await verifyMetaSignature(body, null, "s3cret"), false);
  });

  it("flattens Messenger and Instagram messages, echoes and postbacks; ignores the rest", () => {
    const events = parseMetaWebhook({
      object: "page",
      entry: [
        {
          id: "PAGE1",
          time: 1,
          messaging: [
            { sender: { id: "U1" }, recipient: { id: "PAGE1" }, timestamp: 1700000000000, message: { mid: "m1", text: "Hi" } },
            { sender: { id: "PAGE1" }, recipient: { id: "U1" }, timestamp: 1700000001000, message: { mid: "m2", text: "Hello", is_echo: true } },
            { sender: { id: "U1" }, recipient: { id: "PAGE1" }, timestamp: 1700000002000, message: { mid: "m3", attachments: [{ type: "image", payload: { url: "https://x/y.jpg" } }] } },
            { sender: { id: "U1" }, recipient: { id: "PAGE1" }, read: { watermark: 1 } },
            { sender: { id: "U1" }, recipient: { id: "PAGE1" }, timestamp: 1700000003000, postback: { mid: "m4", title: "Order na" } },
          ],
        },
      ],
    });
    assert.equal(events.length, 4);
    assert.deepEqual(events.map((e) => [e.userId, e.echo, e.kind]), [["U1", false, "text"], ["U1", true, "text"], ["U1", false, "image"], ["U1", false, "text"]]);
    assert.equal(parseMetaWebhook({ object: "instagram", entry: [{ id: "IG1", messaging: [{ sender: { id: "I1" }, message: { mid: "x", text: "yo" } }] }] })[0]!.platform, "instagram");
    assert.equal(parseMetaWebhook({ object: "whatsapp_business_account" }).length, 0);
  });

  it("builds a product card", () => {
    const p = metaMessagePayload({ type: "product", title: "Soap", subtitle: "₱100", imageUrl: null, url: "https://k/x?ref=messenger", buttonTitle: "Order na" }) as { attachment: { payload: { elements: Array<{ buttons: Array<{ url: string }>; image_url?: string }> } } };
    assert.equal(p.attachment.payload.elements[0]!.buttons[0]!.url, "https://k/x?ref=messenger");
    assert.equal("image_url" in p.attachment.payload.elements[0]!, false);
  });
});

describe("marketplace signing", () => {
  it("Shopee: HMAC-SHA256 hex of the joined base string", async () => {
    const expected = createHmac("sha256", "key").update("123/api/v2/shop/auth_partner1700000000").digest("hex");
    assert.equal(await shopeeSign("key", [123, "/api/v2/shop/auth_partner", 1700000000]), expected);
  });
  it("Lazada: uppercase HMAC of path + sorted params", async () => {
    const expected = createHmac("sha256", "sec").update("/orders/getapp_keyAKlimit10").digest("hex").toUpperCase();
    assert.equal(await lazadaSign("sec", "/orders/get", { limit: "10", app_key: "AK" }), expected);
    assert.equal(listingKey("1", ""), "1:");
  });
});

describe("token box", () => {
  it("seals and opens; tampering fails", async () => {
    const sealed = await sealToken("EAAB-page-token");
    assert.notEqual(sealed.includes("EAAB"), true);
    assert.equal(await openToken(sealed), "EAAB-page-token");
    assert.equal(await openToken(`${sealed.slice(0, -2)}xx`), null);
    assert.equal(await openToken(null), null);
  });
});

describe("buyer emails", () => {
  const ctx = {
    shopName: "Tess <Lifestyle>",
    orderNumber: "TES-0012",
    buyerName: "Ana Reyes",
    items: [{ title: "Mug", quantity: 2, lineTotal: 698 }],
    subtotal: 698,
    deliveryFee: 60,
    discount: 0,
    total: 758,
    paymentMethod: "cod",
    deliveryType: "delivery",
    orderUrl: "https://kart.guma.one/tess/orders/TES-0012?t=x",
    codDue: true,
  };
  it("order emails list the items and escape HTML", () => {
    const m = orderEmail("order_created", ctx);
    assert.match(m.subject, /TES-0012/);
    assert.match(m.text, /Mug x2/);
    assert.match(m.text, /Delivery: ₱60\.00/);
    assert.ok(m.html.includes("Tess &lt;Lifestyle&gt;"));
    assert.ok(!m.html.includes("<Lifestyle>"));
    assert.match(orderEmail("out_for_delivery", ctx).text, /Ihanda ang ₱758\.00/);
    assert.match(orderEmail("shipped", { ...ctx, deliveryType: "pickup", pickupAddress: "Rizal St." }).subject, /Ready for pickup/);
  });
  it("POS e-receipt", () => {
    const r = posReceiptEmail({ shopName: "Tess", orderNumber: "TES-1", invoiceNumber: "SI0000000002", createdAt: new Date(), cashierName: "Jen", items: [{ title: "Mug", quantity: 1, lineTotal: 349 }], subtotal: 349, discount: 0, total: 349, tenders: [{ method: "cash", amount: 500 }], change: 151, notOfficial: false });
    assert.match(r.text, /Sales invoice SI0000000002/);
    assert.match(r.text, /Change: ₱151\.00/);
    assert.equal(isEmailAddress("ana@gmail.com"), true);
    assert.equal(isEmailAddress("ana@gmail"), false);
  });
});
