/**
 * Phase 24: Code 128 barcodes as SVG — no library. Uses code set C for all-digit codes (pairs; an odd
 * last digit switches to B) and code set B otherwise (printable ASCII). POS scanners read both.
 * Checked against python-barcode's output while building.
 */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const START_C = 105;
const STOP = 106;

export const CODE128_PATTERNS = PATTERNS;

/** Symbol values (start, data, checksum, stop) for `text`. Throws on characters Code 128 B can't carry. */
export function code128Values(text: string): number[] {
  if (!text) throw new Error("Nothing to encode.");
  const digits = /^\d+$/.test(text) && text.length >= 4;
  const values: number[] = [digits ? START_C : START_B];
  if (digits) {
    // Pairs in code set C; an odd last digit switches to code set B (value 100 in set C).
    const even = text.length - (text.length % 2);
    for (let i = 0; i < even; i += 2) values.push(Number(text.slice(i, i + 2)));
    if (even < text.length) values.push(100, text.charCodeAt(even) - 32);
  } else {
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 126) throw new Error("Barcodes can only use plain letters, numbers and symbols.");
      values.push(code - 32);
    }
  }
  const checksum = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  values.push(checksum, STOP);
  return values;
}

/** Bar/space module widths, alternating bar first, including the quiet zones (10 modules each). */
export function code128Modules(text: string): number[] {
  const widths: number[] = [10];
  for (const v of code128Values(text)) for (const d of PATTERNS[v]!) widths.push(Number(d));
  widths.push(10);
  return widths;
}

/** An SVG string, width in modules; scale it with CSS. */
export function code128Svg(text: string, height = 40): { svg: string; modules: number } {
  const widths = code128Modules(text);
  let x = 0;
  const rects: string[] = [];
  widths.forEach((w, i) => {
    // index 0 is the leading quiet zone (space); after it bars are odd indexes
    if (i > 0 && i % 2 === 1) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
    x += w;
  });
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges">${rects.join("")}</svg>`,
    modules: x,
  };
}

/** EAN-13 check digit for 12 digits. */
export function ean13CheckDigit(twelve: string): number {
  const sum = [...twelve].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}
