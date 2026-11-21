import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchCommentTrigger, pickPublicReply } from "./comment-triggers";

const DEFAULTS = ["HM", "MINE", "Available pa?", "Details", "Magkano"];

describe("comment-to-DM keyword matching", () => {
  it("matches how Pinoy buyers actually comment", () => {
    for (const [text, kw] of [
      ["HM po??", "HM"],
      ["hm", "HM"],
      ["How much po ito?", "HM"],
      ["magkanu po", "HM"],
      ["Mine!!!", "MINE"],
      ["mine po 😍", "MINE"],
      ["avail pa po ba?", "Available pa?"],
      ["meron pa po?", "Available pa?"],
      ["pa PM po", "Details"],
      ["dets please", "Details"],
      ["MAGKANO", "HM"],
    ] as const) {
      assert.equal(matchCommentTrigger(text, DEFAULTS), kw, text);
    }
  });
  it("doesn't fire on unrelated comments, substrings or rants", () => {
    for (const text of ["Ang ganda!", "minecraft skin to", "shame on you", "😍😍", "x".repeat(300)]) assert.equal(matchCommentTrigger(text, DEFAULTS), null, text);
  });
  it("seller's own keywords work too", () => {
    assert.equal(matchCommentTrigger("SALE po ba ito", ["SALE"]), "SALE");
    assert.equal(matchCommentTrigger("ORDER", ["order"]), "order");
  });
  it("rotates public replies deterministically", () => {
    const t = ["A", "B", "C"];
    assert.equal(pickPublicReply(t, "c1"), pickPublicReply(t, "c1"));
    assert.ok(new Set(["c1", "c2", "c3", "c4", "c5", "c6"].map((c) => pickPublicReply(t, c))).size > 1);
    assert.match(pickPublicReply([], "x"), /DM/);
  });
});
