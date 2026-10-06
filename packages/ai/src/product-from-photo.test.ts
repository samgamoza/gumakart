import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPhotoListingPrompt, parsePhotoListing, runPhotoListing } from "./product-from-photo";

describe("photo → listing (Phase 33)", () => {
  it("the prompt forbids prices and unseen claims and carries the seller's note", () => {
    const p = buildPhotoListingPrompt({ imageBase64: "x", mimeType: "image/jpeg", shopName: "Tess", shopCategory: "bags", hint: "pre-loved" });
    assert.match(p.system, /Never state a price/);
    assert.match(p.user, /pre-loved/);
    assert.match(p.user, /sells bags/);
  });

  it("cleans the reply: banned claims, emojis, tag noise, lengths", () => {
    const out = parsePhotoListing(
      '```json\n{"title":"Genuine Leather Tote 👜","description":"100% authentic tote. Kasya laptop.","tags":["Tote","tote","Bag!","x"],"productType":"bag","checks":["Size","Material","Price","Extra"]}\n```'
    );
    assert.equal(out.title, "Leather Tote");
    assert.equal(out.description, "tote. Kasya laptop.");
    assert.deepEqual(out.tags, ["tote", "bag"]);
    assert.equal(out.checks.length, 3);
  });

  it("rejects unreadable or empty replies", () => {
    assert.throws(() => parsePhotoListing("not json"));
    assert.throws(() => parsePhotoListing('{"title":"","description":""}'));
  });

  it("uses the mock when no key is set in tests", async () => {
    const saved = { g: process.env.GEMINI_API_KEY, o: process.env.OPENAI_API_KEY, n: process.env.NODE_ENV };
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    (process.env as Record<string, string>).NODE_ENV = "test";
    const r = await runPhotoListing({ imageBase64: "x", mimeType: "image/png", shopName: "Tess" });
    assert.equal(r.model, "mock");
    assert.ok(r.output.title.length > 2);
    if (saved.g) process.env.GEMINI_API_KEY = saved.g;
    if (saved.o) process.env.OPENAI_API_KEY = saved.o;
    (process.env as Record<string, string | undefined>).NODE_ENV = saved.n;
  });
});
