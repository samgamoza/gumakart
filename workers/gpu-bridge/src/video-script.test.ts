import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VideoAdPayload } from "@gumakart/ai/studio";
import { buildScriptMessages, facts, normalizeTiming, parseScript, scrubUnbackedClaims, templateScript } from "./video-script";

const payload = (extra: Partial<VideoAdPayload> = {}): VideoAdPayload => ({
  imageUrls: ["/uploads/products/t/a.png"],
  productTitle: "Aqua Flask Tumbler",
  price: 599,
  promoPrice: 449,
  voiceStyle: "energetic_filipina",
  durationSec: 15,
  shopName: "Simply Sweet",
  storeUrl: "https://kart.guma.one/simply-sweet",
  paymentMethods: ["cod", "gcash"],
  ...extra,
});

describe("video script", () => {
  it("prompt carries only real facts", () => {
    const f = facts(payload()).join("\n");
    assert.match(f, /₱449 \(regular ₱599\)/);
    assert.match(f, /COD, GCash/);
    assert.ok(!/Stock left/.test(f) && !/Free shipping/.test(f));
    assert.match(facts(payload({ stockLeft: 7, freeShipping: true })).join("\n"), /Stock left: 7[\s\S]*Free shipping via BayanGo: YES/);
    const sys = String(buildScriptMessages(payload())[0]!.content);
    assert.match(sys, /Never invent stock counts/);
    assert.match(sys, /32–40/);
  });

  it("parses model JSON (with fences), fixes bad timing, scrubs made-up claims", () => {
    const raw =
      '```json\n{"scenes":[{"role":"hook","start":0,"end":1,"line":"Uy! Last 15 slots na lang!","visual":"fast push-in"},' +
      '{"role":"body","start":1,"end":2,"line":"₱449 lang po, FREE SHIPPING pa today!"},{"role":"cta","start":2,"end":15,"line":"Order na sa link po!"}]}\n```';
    const s = parseScript(raw, payload())!;
    assert.equal(s.source, "llm");
    assert.deepEqual(s.scenes.map((x) => [x.start, x.end]), [[0, 4], [4, 10], [10, 15]], "1-second scenes replaced by the default split");
    assert.ok(!/15 slots/.test(s.scenes[0]!.line) && /habang may stock pa/.test(s.scenes[0]!.line));
    assert.ok(!/FREE SHIPPING/i.test(s.scenes[1]!.line));
    assert.equal(s.scenes[1]!.visual.length > 0, true, "default visual filled in");
    assert.equal(parseScript("not json", payload()), null);
    assert.equal(parseScript('{"scenes":[]}', payload()), null);
  });

  it("keeps real stock numbers", () => {
    assert.equal(scrubUnbackedClaims("7 pcs na lang!", payload({ stockLeft: 7 })), "7 pcs na lang!");
    assert.equal(scrubUnbackedClaims("8 pcs na lang!", payload({ stockLeft: 7 })), "habang may stock pa!");
  });

  it("timing + template fallback", () => {
    assert.deepEqual(normalizeTiming([{ start: 0, end: 6 }, { start: 6, end: 20 }, { start: 20, end: 30 }], 30), [[0, 6], [6, 20], [20, 30]]);
    const t = templateScript(payload({ stockLeft: 5, freeShipping: true }));
    assert.equal(t.source, "template");
    assert.match(t.scenes[1]!.line, /₱449 na lang, dati ₱599/);
    assert.match(t.scenes[1]!.line, /5 piraso na lang/);
    assert.match(t.scenes[1]!.line, /BayanGo/);
    assert.match(templateScript(payload()).scenes[1]!.line, /Habang may stock pa/);
  });
});
