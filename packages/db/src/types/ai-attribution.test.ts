import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aiAttributionOf } from "./ai-attribution";

describe("aiAttributionOf", () => {
  it("seller-made link with no AI involvement is neither", () => {
    assert.deepEqual(aiAttributionOf({ linkOrigin: "seller", utmSource: "facebook" }), { assisted: false, closed: false });
    assert.deepEqual(aiAttributionOf({ linkOrigin: null, utmSource: null }), { assisted: false, closed: false });
  });
  it("AI draft the seller sent is assisted, not closed", () => {
    assert.deepEqual(aiAttributionOf({ linkOrigin: "ai_draft", utmSource: null }), { assisted: true, closed: false });
  });
  it("link the AI sent on its own is assisted and closed", () => {
    assert.deepEqual(aiAttributionOf({ linkOrigin: "ai_auto", utmSource: null }), { assisted: true, closed: true });
  });
  it("shop assistant utm tag is assisted but can never be closed", () => {
    assert.deepEqual(aiAttributionOf({ linkOrigin: null, utmSource: "shop_assistant" }), { assisted: true, closed: false });
    assert.deepEqual(aiAttributionOf({ linkOrigin: "seller", utmSource: "shop_assistant" }), { assisted: true, closed: false });
  });
});
