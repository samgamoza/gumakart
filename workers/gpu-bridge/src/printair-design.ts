/**
 * AI suite Phase 5 — print-ready branded packaging flats (pure helpers, unit tested).
 * The shop's REAL logo and QR code are composited by FFmpeg at 300 dpi — never regenerated —
 * then Flux.1 Fill paints a photo scene around each flat for the mockup images.
 */
import { assEscape } from "./subtitles";

export type PrintairItemId = "thank_you_card" | "parcel_sticker" | "mailer_box";

export const DPI = 300;

export interface ItemSpec {
  id: PrintairItemId;
  widthIn: number;
  heightIn: number;
  scenePrompt: string;
}

export const ITEM_SPECS: Record<PrintairItemId, ItemSpec> = {
  thank_you_card: {
    id: "thank_you_card",
    widthIn: 4,
    heightIn: 6,
    scenePrompt:
      "a printed thank-you card lying on a light wooden table beside a kraft paper parcel, tissue paper and dried flowers, soft natural window light, top-down flat lay product photography, photorealistic",
  },
  parcel_sticker: {
    id: "parcel_sticker",
    widthIn: 3,
    heightIn: 3,
    scenePrompt:
      "a square printed sticker stuck flat on the top of a brown kraft cardboard shipping box, close-up, soft daylight, realistic paper and cardboard texture, product photography, photorealistic",
  },
  mailer_box: {
    id: "mailer_box",
    widthIn: 8,
    heightIn: 6,
    scenePrompt:
      "the printed front panel of a corrugated mailer box, the box standing on a clean white desk, soft studio light, realistic cardboard edges and a soft shadow, e-commerce packaging product photography, photorealistic",
  },
};

export function pixels(spec: ItemSpec): { width: number; height: number } {
  return { width: Math.round(spec.widthIn * DPI), height: Math.round(spec.heightIn * DPI) };
}

/** "#AABBCC" → [r, g, b]; falls back to Guma violet. */
export function parseHex(hex: string | null | undefined): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  const v = m ? m[1]! : "6D28D9";
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function toHex([r, g, b]: [number, number, number]): string {
  return [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Mix toward white (amount 0..1). */
export function tint(rgb: [number, number, number], amount: number): [number, number, number] {
  return rgb.map((c) => c + (255 - c) * amount) as [number, number, number];
}

export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** ASS colour is &HBBGGRR. */
export function assColor([r, g, b]: [number, number, number]): string {
  return `&H00${toHex([b, g, r])}&`;
}

export interface TextLine {
  text: string;
  y: number;
  size: number;
  bold?: boolean;
}

export interface FlatLayout {
  width: number;
  height: number;
  background: [number, number, number];
  ink: [number, number, number];
  logo: { maxW: number; maxH: number; y: number } | null;
  qr: { size: number; x: number | "center"; y: number };
  lines: TextLine[];
}

/** Where everything goes on each item (300 dpi px). */
export function layoutFor(
  id: PrintairItemId,
  brand: { color: string | null | undefined; shopName: string; tagline?: string | null; storeUrl: string; hasLogo: boolean }
): FlatLayout {
  const spec = ITEM_SPECS[id];
  const { width, height } = pixels(spec);
  const brandRgb = parseHex(brand.color);
  const url = brand.storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const name = brand.shopName.slice(0, 40);
  const tagline = brand.tagline?.slice(0, 60) || null;
  if (id === "parcel_sticker") {
    const bg = brandRgb;
    const ink: [number, number, number] = luminance(bg) > 0.45 ? [24, 24, 27] : [255, 255, 255];
    return {
      width,
      height,
      background: bg,
      ink,
      logo: brand.hasLogo ? { maxW: 520, maxH: 260, y: 70 } : null,
      qr: { size: 250, x: "center", y: 520 },
      lines: [
        { text: name, y: brand.hasLogo ? 350 : 170, size: brand.hasLogo ? 64 : 96, bold: true },
        { text: "Handle with love", y: brand.hasLogo ? 440 : 320, size: 42 },
        { text: url, y: 800, size: 30 },
      ],
    };
  }
  if (id === "mailer_box") {
    const bg = tint(brandRgb, 0.9);
    return {
      width,
      height,
      background: bg,
      ink: [24, 24, 27],
      logo: brand.hasLogo ? { maxW: 1200, maxH: 620, y: 260 } : null,
      qr: { size: 330, x: width - 330 - 90, y: height - 330 - 90 },
      lines: [
        { text: name, y: brand.hasLogo ? 980 : 640, size: brand.hasLogo ? 130 : 190, bold: true },
        ...(tagline ? [{ text: tagline, y: brand.hasLogo ? 1150 : 880, size: 66 }] : []),
        { text: url, y: height - 150, size: 44 },
      ],
    };
  }
  // thank_you_card
  const bg = tint(brandRgb, 0.92);
  return {
    width,
    height,
    background: bg,
    ink: [24, 24, 27],
    logo: brand.hasLogo ? { maxW: 640, maxH: 420, y: 150 } : null,
    qr: { size: 420, x: "center", y: 1110 },
    lines: [
      { text: "Thank you for your order!", y: brand.hasLogo ? 650 : 330, size: 84, bold: true },
      { text: `Love, ${name}`, y: brand.hasLogo ? 800 : 500, size: 62 },
      ...(tagline ? [{ text: tagline, y: brand.hasLogo ? 900 : 610, size: 46 }] : []),
      { text: "Scan to shop again", y: 1560, size: 50, bold: true },
      { text: url, y: 1640, size: 38 },
    ],
  };
}

/** One .ass "subtitle" file that draws the static text (libass — same renderer as the video ads). */
export function buildDesignAss(layout: FlatLayout, font: string): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${layout.width}`,
    `PlayResY: ${layout.height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Print,${font},60,${assColor(layout.ink)},${assColor(layout.ink)},&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,8,40,40,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = layout.lines.map(
    (l) => `Dialogue: 0,0:00:00.00,0:00:10.00,Print,,0,0,0,,{\\an8\\pos(${Math.round(layout.width / 2)},${l.y})\\fs${l.size}\\b${l.bold ? 1 : 0}}${assEscape(l.text)}`
  );
  return [...header, ...events, ""].join("\n");
}

/** FFmpeg args for one flat: solid background → logo → QR → text, one PNG frame (pure). */
export function designArgs(input: { layout: FlatLayout; logo: string | null; qr: string; ass: string; output: string }): string[] {
  const L = input.layout;
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=0x${toHex(L.background)}:s=${L.width}x${L.height}:d=1`];
  const parts: string[] = [];
  let cur = "[0:v]";
  let idx = 1;
  if (input.logo && L.logo) {
    args.push("-i", input.logo);
    parts.push(`[${idx}:v]scale=w=${L.logo.maxW}:h=${L.logo.maxH}:force_original_aspect_ratio=decrease,format=rgba[logo]`);
    parts.push(`${cur}[logo]overlay=x=(W-w)/2:y=${L.logo.y}+(${L.logo.maxH}-h)/2[bg1]`);
    cur = "[bg1]";
    idx += 1;
  }
  args.push("-i", input.qr);
  const qx = L.qr.x === "center" ? "(W-w)/2" : String(L.qr.x);
  parts.push(`[${idx}:v]scale=${L.qr.size}:${L.qr.size}:flags=neighbor,format=rgba[qr]`);
  parts.push(`${cur}[qr]overlay=x=${qx}:y=${L.qr.y}[bg2]`);
  parts.push(`[bg2]ass=${input.ass},format=rgb24[out]`);
  args.push("-filter_complex", parts.join(";"), "-map", "[out]", "-frames:v", "1", input.output);
  return args;
}

/**
 * Minimal PDF (one page per flat, each page the item's real size at 72 pt/in, the 300 dpi JPEG
 * filling it). Print shops take this as-is; no fonts, no external deps.
 */
export function buildPrintPdf(pages: Array<{ jpeg: Uint8Array; widthPx: number; heightPx: number; widthIn: number; heightIn: number; title: string }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === "string" ? enc.encode(b) : b;
    chunks.push(bytes);
    length += bytes.byteLength;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push("\nendobj\n");
  };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const pageIds = pages.map((_p, i) => 3 + i * 3);
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`));
  pages.forEach((p, i) => {
    const pageId = 3 + i * 3;
    const contentId = pageId + 1;
    const imgId = pageId + 2;
    const w = (p.widthIn * 72).toFixed(2);
    const h = (p.heightIn * 72).toFixed(2);
    obj(pageId, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    obj(contentId, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(imgId, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.widthPx} /Height ${p.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.byteLength} >>\nstream\n`);
      push(p.jpeg);
      push("\nendstream");
    });
  });
  const total = 3 + pages.length * 3;
  const xrefAt = length;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n += 1) push(`${String(offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info << /Producer (Guma Kart) /Title (${pages.map((p) => p.title).join(", ").replace(/[()\\]/g, "")}) >> >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}
