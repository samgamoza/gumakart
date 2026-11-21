import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBroadcastPrompt, defaultBroadcastDraft, polishBroadcast, sanitizeBroadcast } from "./agents/broadcast-writer";
import { parseReviewRating, reviewBodyFrom, reviewPromptText, reviewThanksText } from "./review-loop";

describe("broadcast polish (Phase 4.2)", () => {
  it("keeps placeholders, guarantees {link}, scrubs invented claims (D5)", () => {
    const s = sanitizeBroadcast("Hi {name}! Last 3 pcs na lang, 500+ sold, free shipping pa! {promo}", "fallback {link}");
    assert.ok(!/last 3|500\+ sold|free shipping|\{promo\}/i.test(s.text), s.text);
    assert.match(s.text, /\{name\}/);
    assert.match(s.text, /\{link\}$/);
    assert.ok(s.guards.includes("link_added"));
    assert.equal(sanitizeBroadcast("{link}", "fallback {link}").text, "fallback {link}");
  });
  it("payday / restock drafts read naturally and carry the link", () => {
    assert.match(defaultBroadcastDraft("payday"), /Payday na!.*\{item\}.*\{link\}/);
    assert.match(defaultBroadcastDraft("restock", "Ube Jam"), /Ube Jam.*\{link\}/);
    const p = buildBroadcastPrompt({ draft: "x", kind: "restock", shopName: "S", productTitle: "Ube Jam", channel: "whatsapp" });
    assert.match(p.system, /\{name\}, \{item\}, \{link\}, \{shop\}/);
    assert.match(p.system, /NEVER invent discounts/);
    assert.match(p.system, /Ube Jam/);
  });
  it("no bridge, no cloud keys → the seller's own draft (sanitised), never an error", async () => {
    const r = await polishBroadcast({ draft: "Hi {name}, sale tayo!", kind: "custom", shopName: "S", channel: "messenger" }, { tenantId: "t", bridge: null });
    assert.equal(r.servedBy, "template");
    assert.equal(r.text, "Hi {name}, sale tayo! {link}");
  });
});

describe("review loop (Phase 4.3)", () => {
  it("reads ratings the way buyers write them", () => {
    for (const [text, n] of [
      ["5", 5],
      ["5!!! sobrang sarap", 5],
      ["4 stars po", 4],
      ["3/5", 3],
      ["⭐⭐⭐⭐", 4],
      ["10/10 babalik ako", 5],
      ["lima po", 5],
      ["Apat", 4],
    ] as const) {
      assert.equal(parseReviewRating(text), n, text);
    }
    for (const text of ["Salamat po!", "nasan na order ko?", "2026 na", "₱500 po ba", "", "100 pcs po"]) assert.equal(parseReviewRating(text), null, text);
  });
  it("keeps what they wrote as the review text", () => {
    assert.equal(reviewBodyFrom("5 sobrang sarap ng ube!"), "sobrang sarap ng ube!");
    assert.equal(reviewBodyFrom("⭐⭐⭐⭐⭐ fresh pa"), "fresh pa");
    assert.equal(reviewBodyFrom("4 stars"), null);
    assert.equal(reviewBodyFrom("lima po. ang bait ng rider"), "ang bait ng rider");
  });
  it("ask + thanks copy: honest voucher wording, single use", () => {
    const ask = reviewPromptText({ buyerName: "Ana Cruz", shopName: "Simply Sweet", item: "Ube Pandesal", reviewUrl: "https://x/r" });
    assert.match(ask, /^Hi Ana! Na-deliver na po ang Ube Pandesal from Simply Sweet/);
    assert.match(ask, /1–5 ⭐/);
    const thanks = reviewThanksText({ rating: 5, voucher: { code: "GKABCD1234", amount: 50, expiresAt: new Date("2026-12-21T00:00:00Z") }, shopName: "Simply Sweet" });
    assert.match(thanks, /\*GKABCD1234\* — ₱50 off/);
    assert.match(thanks, /Isang beses lang magagamit/);
    assert.match(reviewThanksText({ rating: 2, voucher: null, shopName: "S" }), /honest review/);
  });
});
