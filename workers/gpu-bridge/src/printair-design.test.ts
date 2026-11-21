import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import QRCode from "qrcode";
import { assColor, buildDesignAss, buildPrintPdf, designArgs, ITEM_SPECS, layoutFor, luminance, parseHex, pixels, tint } from "./printair-design";
import { buildPrintairMockup } from "./graphs/printair-mockup";
import { imageSize } from "./source-media";

const brand = { color: "#E11D48", shopName: "Simply Sweet", tagline: "Baked with love {\\b1}", storeUrl: "https://kart.guma.one/simply-sweet", hasLogo: true };

describe("printair flats", () => {
  it("sizes are the real print sizes at 300 dpi", () => {
    assert.deepEqual(pixels(ITEM_SPECS.thank_you_card), { width: 1200, height: 1800 });
    assert.deepEqual(pixels(ITEM_SPECS.parcel_sticker), { width: 900, height: 900 });
    assert.deepEqual(pixels(ITEM_SPECS.mailer_box), { width: 2400, height: 1800 });
  });
  it("colours: light tint for the card, readable ink on the sticker", () => {
    assert.deepEqual(parseHex("#E11D48"), [225, 29, 72]);
    assert.deepEqual(parseHex("nope"), [109, 40, 217]);
    assert.ok(luminance(tint([225, 29, 72], 0.92)) > 0.8);
    assert.deepEqual(layoutFor("parcel_sticker", brand).ink, [255, 255, 255], "white on a dark brand colour");
    assert.deepEqual(layoutFor("parcel_sticker", { ...brand, color: "#FDE047" }).ink, [24, 24, 27], "dark on yellow");
    assert.equal(assColor([0x11, 0x22, 0x33]), "&H00332211&");
  });
  it("text is data in the .ass file (no override injection), placed by \\pos", () => {
    const ass = buildDesignAss(layoutFor("thank_you_card", brand), "DejaVu Sans");
    assert.match(ass, /PlayResX: 1200\nPlayResY: 1800/);
    assert.match(ass, /\\pos\(600,\d+\)\\fs84\\b1\}Thank you for your order!/);
    assert.ok(ass.includes("Baked with love ＼b1"), "braces stripped, backslash neutralised");
    assert.match(ass, /kart\.guma\.one\/simply-sweet/);
  });
  it("ffmpeg args: logo is optional, QR + text always", () => {
    const L = layoutFor("mailer_box", brand);
    const withLogo = designArgs({ layout: L, logo: "logo.img", qr: "qr.png", ass: "a.ass", output: "o.png" });
    assert.ok(withLogo.includes("logo.img"));
    assert.match(withLogo.join(" "), /color=c=0x[0-9A-F]{6}:s=2400x1800/);
    const noLogo = designArgs({ layout: layoutFor("mailer_box", { ...brand, hasLogo: false }), logo: null, qr: "qr.png", ass: "a.ass", output: "o.png" });
    assert.ok(!noLogo.includes("logo.img"));
    assert.match(noLogo[noLogo.indexOf("-filter_complex") + 1]!, /^\[1:v\]scale=330:330:flags=neighbor/);
  });

  it("renders real flats with FFmpeg + libass and wraps them in a print PDF", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gk-printair-"));
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x2563EB:s=600x300", "-frames:v", "1", "-f", "image2", "-c:v", "png", "logo.img"], { cwd: dir });
    await writeFile(path.join(dir, "qr.png"), await QRCode.toBuffer(brand.storeUrl, { width: 600 }));
    const pages = [];
    for (const id of ["thank_you_card", "parcel_sticker", "mailer_box"] as const) {
      const layout = layoutFor(id, brand);
      await writeFile(path.join(dir, `${id}.ass`), buildDesignAss(layout, "DejaVu Sans"));
      execFileSync("ffmpeg", designArgs({ layout, logo: "logo.img", qr: "qr.png", ass: `${id}.ass`, output: `${id}.png` }), { cwd: dir });
      const png = new Uint8Array(await readFile(path.join(dir, `${id}.png`)));
      assert.deepEqual(imageSize(png), pixels(ITEM_SPECS[id]));
      execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", `${id}.png`, "-q:v", "2", `${id}.jpg`], { cwd: dir });
      const spec = ITEM_SPECS[id];
      pages.push({ jpeg: new Uint8Array(await readFile(path.join(dir, `${id}.jpg`))), ...{ widthPx: pixels(spec).width, heightPx: pixels(spec).height }, widthIn: spec.widthIn, heightIn: spec.heightIn, title: id });
    }
    const pdf = buildPrintPdf(pages);
    const text = Buffer.from(pdf).toString("latin1");
    assert.ok(text.startsWith("%PDF-1.4"));
    assert.equal((text.match(/\/Type \/Page /g) ?? []).length, 3);
    assert.match(text, /\/MediaBox \[0 0 288\.00 432\.00\]/, "4×6 in card");
    assert.match(text, /\/MediaBox \[0 0 576\.00 432\.00\]/, "8×6 in box panel");
    // xref offsets point at the objects
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    assert.ok(text.slice(xrefAt).startsWith("xref"));
    const first = /0000000000 65535 f \n(\d{10}) 00000 n/.exec(text)![1]!;
    assert.ok(text.slice(Number(first)).startsWith("1 0 obj"));
  });
});

describe("printair mockup graph", () => {
  it("protects the whole flat and paints only the scene; one branch per item", () => {
    const g = buildPrintairMockup({
      items: [
        { key: "thank_you_card", image: "gumakart/a.png", width: 1200, height: 1800, prompt: "card scene" },
        { key: "mailer_box", image: "gumakart/b.png", width: 2400, height: 1800, prompt: "box scene" },
      ],
      seed: 42,
      filenamePrefix: "gk_x",
      models: { unet: "flux1-fill-dev.safetensors", clipL: "clip_l.safetensors", t5: "t5xxl.safetensors", vae: "ae.safetensors" },
    });
    const nodes = Object.values(g);
    assert.equal(nodes.filter((n) => n.class_type === "UNETLoader").length, 1, "shared loaders");
    assert.deepEqual(nodes.filter((n) => n.class_type === "SaveImage").map((n) => n.inputs.filename_prefix), ["gk_x_mockup_thank_you_card", "gk_x_mockup_mailer_box"]);
    const keep = nodes.filter((n) => n.class_type === "SolidMask" && n.inputs.value === 1);
    assert.equal(keep.length, 2);
    assert.ok(nodes.some((n) => n.class_type === "InvertMask"));
    assert.ok(!nodes.some((n) => /RMBG/.test(n.class_type)));
  });
});
