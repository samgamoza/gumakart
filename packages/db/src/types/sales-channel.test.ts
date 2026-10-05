import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSalesChannel, salesChannelOf, withChannelRef } from "./sales-channel";

describe("sales channel", () => {
  it("explicit and POS win", () => {
    assert.equal(salesChannelOf({ explicit: "shopee", utm: { ref: "tiktok" } }), "shopee");
    assert.equal(salesChannelOf({ sourceChannel: "pos", utm: { ref: "tiktok" } }), "pos");
  });
  it("ref, then utm_source, then click ids, then the link's share channel", () => {
    assert.equal(salesChannelOf({ utm: { ref: "TT", utm_source: "facebook" } }), "tiktok");
    assert.equal(salesChannelOf({ utm: { utm_source: "IG" } }), "instagram");
    assert.equal(salesChannelOf({ utm: { ttclid: "x", fbclid: "y" } }), "tiktok");
    assert.equal(salesChannelOf({ utm: { igshid: "x", fbclid: "y" } }), "instagram");
    assert.equal(salesChannelOf({ utm: { fbclid: "y" } }), "facebook");
    assert.equal(salesChannelOf({ utm: { ref: "nonsense" }, shareChannel: "messenger" }), "messenger");
    assert.equal(salesChannelOf({}), "direct");
  });
  it("normalizes aliases", () => {
    assert.equal(normalizeSalesChannel("m.me"), "messenger");
    assert.equal(normalizeSalesChannel(""), null);
  });
  it("tags share URLs", () => {
    assert.equal(withChannelRef("https://kart.guma.one/c/ABC", "tiktok"), "https://kart.guma.one/c/ABC?ref=tiktok");
    assert.equal(withChannelRef("https://kart.guma.one/shop/p/x?a=1", "instagram"), "https://kart.guma.one/shop/p/x?a=1&ref=instagram");
    assert.equal(withChannelRef("https://kart.guma.one/c/ABC?ref=facebook", "tiktok"), "https://kart.guma.one/c/ABC?ref=tiktok");
    assert.equal(withChannelRef("https://kart.guma.one/c/ABC?a=1&ref=facebook&b=2", "tiktok"), "https://kart.guma.one/c/ABC?a=1&ref=tiktok&b=2");
  });
});
