import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchMetaAttachment, fetchWhatsAppMedia, isMetaCdnUrl, parseWhatsAppWebhook, sendWhatsAppTemplate } from "./channels/whatsapp";
import { parseBayanGoWebhook } from "./delivery/bayango";
import { EcosystemJwtError, signEcosystemJwt, verifyEcosystemJwt } from "./ecosystem/jwt";

const SECRET = "test-ecosystem-secret-0123456789abcdef";

describe("WhatsApp templates & media (Phase 4)", () => {
  it("sends an approved template with body params in order", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await sendWhatsAppTemplate({ phoneNumberId: "111", token: "tok", to: "639171234567", templateName: "payday_reorder", language: "en", bodyParams: ["Ana", "https://kart.guma.one/s/reorder/x\n"], fetch: fake });
    assert.deepEqual(r, { success: true, messageId: "wamid.1" });
    assert.match(calls[0]!.url, /\/111\/messages$/);
    assert.deepEqual(calls[0]!.body.template, {
      name: "payday_reorder",
      language: { code: "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "https://kart.guma.one/s/reorder/x " }] }],
    });
  });
  it("downloads media only from Meta's CDNs", async () => {
    assert.ok(isMetaCdnUrl("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1"));
    assert.ok(isMetaCdnUrl("https://scontent.xx.fbcdn.net/v/t1.jpg"));
    assert.ok(!isMetaCdnUrl("https://evil.example/fbcdn.net.jpg"));
    assert.ok(!isMetaCdnUrl("http://scontent.xx.fbcdn.net/x.jpg"));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    const fake = (async (url: string) => {
      if (url.includes("graph.facebook.com")) return new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/m/1", mime_type: "image/png", file_size: 8 }), { status: 200 });
      return new Response(png, { status: 200 });
    }) as unknown as typeof fetch;
    const got = await fetchWhatsAppMedia("123", "tok", fake);
    assert.equal(got?.contentType, "image/png");
    assert.equal(got?.bytes.byteLength, 8);
    const evil = (async (url: string) =>
      url.includes("graph.facebook.com") ? new Response(JSON.stringify({ url: "https://169.254.169.254/latest" }), { status: 200 }) : new Response("x")) as unknown as typeof fetch;
    assert.equal(await fetchWhatsAppMedia("123", "tok", evil), null);
    assert.equal(await fetchMetaAttachment("https://example.com/a.jpg"), null);
  });
  it("parses the photo's media id", () => {
    const [e] = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "111" }, contacts: [{ wa_id: "639171234567" }], messages: [{ from: "639171234567", id: "wamid.p", type: "image", image: { id: "MEDIA1", caption: "5 sobrang sarap" } }] } }] }],
    });
    assert.equal(e!.mediaId, "MEDIA1");
    assert.equal(e!.text, "5 sobrang sarap");
  });
});

describe("BayanGo delivery.completed (Phase 4.3)", () => {
  it("is a delivered status change", () => {
    const e = parseBayanGoWebhook({ eventId: "e1", type: "delivery.completed", occurredAt: "2026-11-21T08:00:00Z", delivery: { deliveryId: "d1", externalRef: "o1" } });
    assert.equal(e?.type, "delivery.completed");
    assert.equal(e?.delivery.status, "delivered");
    assert.equal(parseBayanGoWebhook({ eventId: "e1", type: "delivery.completed", delivery: { deliveryId: "d1", status: "en_route_dropoff" } }), null, "completed must mean delivered");
  });
});

describe("ecosystem JWT (Phase 5.2)", () => {
  it("signs a short-lived HS256 token Printair can verify", async () => {
    const now = new Date("2026-11-21T08:00:00Z");
    const { token, expiresAt } = await signEcosystemJwt({ iss: "gumakart", aud: "printair", sub: "t1", merchant_id: "t1", mockups: [{ url: "https://m/1.png" }] }, SECRET, { ttlSeconds: 300, now });
    assert.equal(expiresAt.toISOString(), "2026-11-21T08:05:00.000Z");
    const claims = await verifyEcosystemJwt(token, SECRET, { aud: "printair", iss: "gumakart", now });
    assert.equal(claims.merchant_id, "t1");
    assert.ok(claims.jti);
    await assert.rejects(verifyEcosystemJwt(token, SECRET, { aud: "printair", now: new Date("2026-11-21T08:06:00Z") }), EcosystemJwtError);
    await assert.rejects(verifyEcosystemJwt(token, SECRET, { aud: "other", now }), /audience/);
    await assert.rejects(verifyEcosystemJwt(token, "another-secret-0123456789abcdefghij", { aud: "printair", now }), /signature/);
    const [h, p, s] = token.split(".");
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...claims, merchant_id: "t2" })).toString("base64url")}.${s}`;
    await assert.rejects(verifyEcosystemJwt(tampered, SECRET, { aud: "printair", now }), /signature/);
    assert.ok(p);
    await assert.rejects(signEcosystemJwt({ iss: "a", aud: "b", sub: "c" }, "short"), /32 characters/);
  });
});
