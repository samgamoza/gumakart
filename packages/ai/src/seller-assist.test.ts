import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAssistPrompt, mockAssist, parseAssistOutput, type AdvisorFacts } from "./seller-assist";

const link = "https://kart.guma.one/c/abc123";
const facts: AdvisorFacts = {
  shopName: "Tess", periodDays: 30, sales: 12500, orders: 25, aov: 500, previousSales: 10000,
  topProducts: [{ title: "Canvas Backpack", units: 12, sales: 6000 }],
  restock: [{ title: "Canvas Backpack", stock: 3, daysLeft: 2, suggestedQty: 20 }],
  pendingPayments: 2, toShip: 4,
};

describe("seller assist", () => {
  it("captions always carry the checkout link, strip HTML, clean hashtags", () => {
    const raw = JSON.stringify({ facebook: "<b>Bagong drop!</b>", instagram: `Ganda! ${link}`, tiktok: "POV: ikaw na", hashtags: ["ShopLocal", "#GumaKart", "#ok tag!", "#"] });
    const o = parseAssistOutput("captions", raw, { shopName: "Tess", productTitle: "Bag", link });
    assert.ok(o.facebook.includes(link) && !o.facebook.includes("<b>"));
    assert.equal(o.instagram.split(link).length - 1, 1, "link not duplicated");
    assert.ok(o.tiktok.includes(link));
    assert.deepEqual(o.hashtags, ["#ShopLocal", "#oktag"]);
  });

  it("accepts fenced JSON and keeps at most 3 distinct replies", () => {
    const raw = "```json\n" + JSON.stringify({ replies: ["Hi po!", "Hi po!", "Opo, available.", "Salamat po", "Extra"] }) + "\n```";
    const o = parseAssistOutput("replies", raw, { shopName: "Tess", buyerMessage: "hm?", facts: [] });
    assert.deepEqual(o.replies, ["Hi po!", "Opo, available.", "Salamat po"]);
  });

  it("rejects malformed output instead of passing junk through", () => {
    assert.throws(() => parseAssistOutput("advisor", '{"nope":1}', { question: "q", facts }));
    assert.throws(() => parseAssistOutput("replies", "not json", { shopName: "x", buyerMessage: "y", facts: [] }));
  });

  it("advisor prompt carries the real shop facts and the no-invention rule", () => {
    const p = buildAssistPrompt("advisor", { question: "Ano ang best seller ko?", facts });
    assert.match(p.user, /"sales":12500/);
    assert.match(p.system, /Never invent/);
  });

  it("captions prompt says not to mention a price when none is given", () => {
    assert.match(buildAssistPrompt("captions", { shopName: "T", productTitle: "Bag", link }).user, /do not mention a price/);
  });

  it("the no-key fallback uses only the given facts", () => {
    const a = mockAssist("advisor", { question: "kumusta?", facts }) as { answer: string; actions: string[] };
    assert.match(a.answer, /₱12,500/);
    assert.match(a.answer, /Tumaas ng 25%/);
    assert.match(a.answer, /Canvas Backpack/);
    assert.equal(a.actions.length, 3);
    const c = mockAssist("captions", { shopName: "T", productTitle: "Bag", price: 499, link }) as { facebook: string };
    assert.ok(c.facebook.includes(link) && c.facebook.includes("₱499"));
  });

  it("supplier note keeps the exact quantities, adding the list if the model drops any", () => {
    const items = [{ title: "Canvas Backpack — Sand", qty: 20, stock: 0 }, { title: "Mug", qty: 8, stock: 2 }];
    const o = parseAssistOutput("supplier", JSON.stringify({ message: "Hi po! Order po kami ng Canvas Backpack — Sand 20 pcs." }), { shopName: "Tess", items });
    assert.match(o.message, /• Mug — 8 pcs/);
    const m = mockAssist("supplier", { shopName: "Tess", supplierName: "Kuya Ben", items }) as { message: string };
    assert.match(m.message, /Kuya Ben/);
    assert.match(m.message, /Canvas Backpack — Sand — 20 pcs/);
  });
});
