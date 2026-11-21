import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { extractInstagramShortcode, extractPfbid, metaMessagePayload, parseMetaCommentEvents, parseMetaWebhook, resolveFacebookPostId, resolveInstagramMediaId } from "./meta";
import { parseWhatsAppWebhook, sendWhatsAppMessage, whatsAppPayload } from "./whatsapp";
import { quoteChatDelivery } from "../delivery/chat-quote";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Meta comment webhooks", () => {
  it("parses Facebook feed comments and Instagram comments; flags our own", () => {
    const fb = parseMetaCommentEvents({
      object: "page",
      entry: [
        {
          id: "111",
          time: 1_800_000_000,
          changes: [
            { field: "feed", value: { item: "comment", verb: "add", comment_id: "222_333", post_id: "111_222", parent_id: "111_222", from: { id: "999", name: "Ana" }, message: "HM po?", created_time: 1_800_000_000 } },
            { field: "feed", value: { item: "comment", verb: "add", comment_id: "222_334", post_id: "111_222", from: { id: "111", name: "Shop" }, message: "Sent you a DM po!" } },
            { field: "feed", value: { item: "reaction", verb: "add" } },
            { field: "feed", value: { item: "comment", verb: "remove", comment_id: "x" } },
          ],
        },
      ],
    });
    assert.equal(fb.length, 2);
    assert.deepEqual([fb[0]!.commentId, fb[0]!.postId, fb[0]!.fromName, fb[0]!.text, fb[0]!.isOwn], ["222_333", "111_222", "Ana", "HM po?", false]);
    assert.equal(fb[1]!.isOwn, true);
    const ig = parseMetaCommentEvents({ object: "instagram", entry: [{ id: "17841", time: 1_800_000_000, changes: [{ field: "comments", value: { id: "c1", text: "mine!", from: { id: "u1", username: "buyer" }, media: { id: "m1" } } }] }] });
    assert.deepEqual([ig[0]!.platform, ig[0]!.postId, ig[0]!.fromName], ["instagram", "m1", "@buyer"]);
    assert.equal(parseMetaCommentEvents({ object: "user" }).length, 0);
  });

  it("keeps postback payloads; builds button templates", () => {
    const ev = parseMetaWebhook({ object: "page", entry: [{ id: "111", messaging: [{ sender: { id: "psid" }, timestamp: 1, postback: { mid: "m1", title: "Switch to COD", payload: "CLOSER:SWITCH_COD:abc" } }] }] });
    assert.equal(ev[0]!.postbackPayload, "CLOSER:SWITCH_COD:abc");
    const p = metaMessagePayload({ type: "buttons", text: "Hi po!", buttons: [{ kind: "url", title: "Complete Payment", url: "https://kart.guma.one/c/abc" }, { kind: "postback", title: "Switch to COD", payload: "CLOSER:SWITCH_COD:1" }] }) as { attachment: { payload: { template_type: string; buttons: Array<Record<string, string>> } } };
    assert.equal(p.attachment.payload.template_type, "button");
    assert.deepEqual(p.attachment.payload.buttons.map((b) => b.type), ["web_url", "postback"]);
  });
});

describe("post link → Graph id", () => {
  it("extracts pfbid tokens and IG shortcodes", () => {
    assert.equal(extractPfbid("https://www.facebook.com/simplysweet/posts/pfbid02AbCdEfGhIjKlMnOpQrStUvWxYz12345l"), "pfbid02AbCdEfGhIjKlMnOpQrStUvWxYz12345l");
    assert.equal(extractPfbid("https://www.facebook.com/x/posts/123"), null);
    assert.equal(extractInstagramShortcode("https://www.instagram.com/reel/C9xYz_AbCd/?igsh=1"), "C9xYz_AbCd");
  });

  it("finds a pfbid post among the Page's posts (paginated) and returns <pageId>_<postId>", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (u: string | URL) => {
      const url = new URL(String(u));
      calls.push(url.pathname + (url.searchParams.get("after") ? `?after=${url.searchParams.get("after")}` : ""));
      if (url.pathname.endsWith("/published_posts") && !url.searchParams.get("after")) {
        return Response.json({ data: [{ id: "111_1", permalink_url: "https://www.facebook.com/111/posts/pfbid0zzz" }], paging: { cursors: { after: "c2" }, next: "https://next" } });
      }
      if (url.pathname.endsWith("/published_posts")) {
        return Response.json({ data: [{ id: "111_2", permalink_url: "https://www.facebook.com/simplysweet/posts/pfbid02AbCdEfGhIjKlMnOpQrStUvWxYz12345l" }] });
      }
      return Response.json({ data: [] });
    }) as typeof fetch;
    const r = await resolveFacebookPostId({ pageId: "111", pageToken: "tok", reference: "https://web.facebook.com/simplysweet/posts/pfbid02AbCdEfGhIjKlMnOpQrStUvWxYz12345l?rdid=x" });
    assert.deepEqual(r, { postId: "111_2", platform: "facebook", permalink: "https://www.facebook.com/simplysweet/posts/pfbid02AbCdEfGhIjKlMnOpQrStUvWxYz12345l" });
    assert.deepEqual(calls, ["/v21.0/111/published_posts", "/v21.0/111/published_posts?after=c2"]);
  });

  it("reels found under videos; IG shortcode → media id; misses return null", async () => {
    globalThis.fetch = (async (u: string | URL) => {
      const url = new URL(String(u));
      if (url.pathname.endsWith("/videos")) return Response.json({ data: [{ id: "777", permalink_url: "/reel/556677889900/" }] });
      if (url.pathname.endsWith("/media")) return Response.json({ data: [{ id: "1789", shortcode: "C9xYz_AbCd", permalink: "https://www.instagram.com/p/C9xYz_AbCd/" }] });
      return Response.json({ data: [] });
    }) as typeof fetch;
    assert.deepEqual(await resolveFacebookPostId({ pageId: "111", pageToken: "t", reference: "https://www.facebook.com/reel/556677889900" }), { postId: "111_777", platform: "facebook", permalink: "/reel/556677889900/" });
    assert.deepEqual(await resolveInstagramMediaId({ igUserId: "178", token: "t", reference: "https://instagram.com/p/C9xYz_AbCd/" }), { postId: "1789", platform: "instagram", permalink: "https://www.instagram.com/p/C9xYz_AbCd/" });
    assert.equal(await resolveInstagramMediaId({ igUserId: "178", token: "t", reference: "https://instagram.com/p/NOPE12345/" }), null);
  });
});

describe("WhatsApp Cloud API", () => {
  it("parses text, button replies and media; ignores statuses", () => {
    const ev = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "PN1" },
                contacts: [{ wa_id: "639171234567", profile: { name: "Ana" } }],
                messages: [
                  { from: "639171234567", id: "wamid.1", timestamp: "1800000000", type: "text", text: { body: "Magkano po?" } },
                  { from: "639171234567", id: "wamid.2", timestamp: "1800000001", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "CLOSER:SWITCH_COD:abc", title: "Switch to COD" } } },
                  { from: "639171234567", id: "wamid.3", timestamp: "1800000002", type: "image", image: { caption: "ito po" } },
                ],
                statuses: [{ id: "wamid.0", status: "read" }],
              },
            },
          ],
        },
      ],
    });
    assert.equal(ev.length, 3);
    assert.deepEqual([ev[0]!.phoneNumberId, ev[0]!.waId, ev[0]!.name, ev[0]!.text], ["PN1", "639171234567", "Ana", "Magkano po?"]);
    assert.equal(ev[1]!.buttonId, "CLOSER:SWITCH_COD:abc");
    assert.equal(ev[2]!.kind, "image");
  });

  it("maps our message shapes to Cloud API payloads", () => {
    assert.deepEqual(whatsAppPayload("63917", { type: "text", text: "hi" }), { messaging_product: "whatsapp", recipient_type: "individual", to: "63917", type: "text", text: { body: "hi", preview_url: true } });
    const cta = whatsAppPayload("63917", { type: "buttons", text: "Bayad na po?", buttons: [{ kind: "url", title: "Complete Payment", url: "https://k/c/x" }] }) as { interactive: { type: string } };
    assert.equal(cta.interactive.type, "cta_url");
    const mixed = whatsAppPayload("63917", { type: "buttons", text: "Bayad na po?", buttons: [{ kind: "url", title: "Pay", url: "https://k/c/x" }, { kind: "postback", title: "Switch to COD", payload: "P" }] }) as { interactive: { type: string; body: { text: string }; action: { buttons: unknown[] } } };
    assert.equal(mixed.interactive.type, "button");
    assert.match(mixed.interactive.body.text, /Pay: https:\/\/k\/c\/x/);
    assert.equal(mixed.interactive.action.buttons.length, 1);
  });

  it("sends with a bearer token and reports API errors", async () => {
    let auth = "";
    const ok = await sendWhatsAppMessage({
      phoneNumberId: "PN1",
      token: "tok",
      to: "63917",
      message: { type: "text", text: "hi" },
      fetch: (async (_u: unknown, init?: RequestInit) => {
        auth = (init!.headers as Record<string, string>).authorization!;
        return Response.json({ messages: [{ id: "wamid.out" }] });
      }) as typeof fetch,
    });
    assert.deepEqual([ok.success, ok.messageId, auth], [true, "wamid.out", "Bearer tok"]);
    const bad = await sendWhatsAppMessage({ phoneNumberId: "PN1", token: "tok", to: "x", message: { type: "text", text: "hi" }, fetch: (async () => Response.json({ error: { message: "Re-engagement message" } }, { status: 400 })) as typeof fetch });
    assert.deepEqual([bad.success, bad.error], [false, "Re-engagement message"]);
  });
});

describe("chat delivery quote", () => {
  const geocode = async (a: string) => ({ lat: "14.5", lng: "121.0", displayName: a });
  const base = { pickupAddress: "Makati City", dropoff: "Brgy. Bagumbayan, Quezon City", flatRate: 89, freeDeliveryMin: 0 };
  it("BayanGo first", async () => {
    const asked: string[][] = [];
    const q = await quoteChatDelivery(base, { geocode, quote: async (_r, p) => { asked.push(p!.allow!); return [{ provider: "bayango", quote: { provider: "bayango", quoteRef: "q", fee: 75.4, currency: "PHP", etaMinutes: 40 } }]; } });
    assert.deepEqual([q.provider, q.fee, q.etaMinutes, q.isLive], ["bayango", 75, 40, true]);
    assert.deepEqual(asked, [["bayango"]]);
  });
  it("Lalamove when outside BayanGo's zone; shop rate when nobody quotes", async () => {
    const q = await quoteChatDelivery(base, { geocode, quote: async (_r, p) => (p!.allow![0] === "bayango" ? [{ provider: "bayango", error: "Not serviceable for this route." }] : [{ provider: "lalamove", quote: { provider: "lalamove", quoteRef: "l", fee: 120, currency: "PHP" } }]) });
    assert.deepEqual([q.provider, q.fee], ["lalamove", 120]);
    const none = await quoteChatDelivery(base, { geocode, quote: async () => [] });
    assert.deepEqual([none.provider, none.fee, none.isLive], ["shop_rate", 89, false]);
    const noGeo = await quoteChatDelivery(base, { geocode: async () => null, quote: async () => { throw new Error("should not quote"); } });
    assert.equal(noGeo.provider, "shop_rate");
  });
  it("free delivery only from the shop's own minimum (D5)", async () => {
    const q = await quoteChatDelivery({ ...base, freeDeliveryMin: 1000, subtotal: 1200 }, { geocode, quote: async () => [{ provider: "bayango", quote: { provider: "bayango", quoteRef: "q", fee: 75, currency: "PHP" } }] });
    assert.deepEqual([q.fee, q.free, q.freeDeliveryMin], [0, true, 1000]);
    const under = await quoteChatDelivery({ ...base, freeDeliveryMin: 1000, subtotal: 500 }, { geocode, quote: async () => [] });
    assert.deepEqual([under.fee, under.free], [89, false]);
  });
});
