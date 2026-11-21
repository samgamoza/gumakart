import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assEscape, assTime, buildAss, chunkWords, kineticCues } from "./subtitles";

describe("kinetic subtitles", () => {
  it("formats ASS times and neutralises override tags in text", () => {
    assert.equal(assTime(0), "0:00:00.00");
    assert.equal(assTime(75.456), "0:01:15.46");
    assert.equal(assEscape("Hi {\\b1}po\\N!\nOrder"), "Hi ＼b1po＼N! Order");
  });
  it("chunks words for pop captions", () => {
    assert.deepEqual(chunkWords("Uy wait lang ito na ang tumbler na hinahanap mo"), ["Uy wait lang", "ito na ang", "tumbler na", "hinahanap mo"]);
  });
  it("cues fill each line's window in order", () => {
    const cues = kineticCues([{ start: 0, end: 3, text: "Uy wait lang ito na" }, { start: 3, end: 6, text: "₱299 lang po" }]);
    assert.equal(cues[0]!.start, 0);
    assert.ok(Math.abs(cues.at(-1)!.end - 6) < 1e-9);
    for (let i = 1; i < cues.length; i += 1) assert.ok(cues[i]!.start >= cues[i - 1]!.start);
  });
  it("builds a valid script with highlighted prices and an end card", () => {
    const ass = buildAss({ cues: [{ start: 0, end: 1, text: "₱299 lang" }, { start: 13, end: 14, text: "hidden" }], endCard: { start: 12, end: 15, lines: ["Simply Sweet", "kart.guma.one/simply-sweet"] }, font: "Arial" });
    assert.match(ass, /PlayResX: 1080/);
    assert.match(ass, /Style: Kinetic,Arial,92/);
    assert.match(ass, /\{\\c&H00D7FF&\}₱299\{\\c&HFFFFFF&\} lang/);
    assert.ok(!ass.includes("hidden"), "captions stop when the end card starts");
    assert.match(ass, /0:00:12\.00,0:00:15\.00,EndCard.*Simply Sweet\\Nkart\.guma\.one\/simply-sweet/);
  });
});
