/**
 * Kinetic Taglish subtitles as an .ass file (burned in by FFmpeg's libass filter), plus the end
 * card text. 1080×1920 canvas.
 */
export interface SubtitleCue {
  start: number; // seconds
  end: number;
  text: string;
}

export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** Text is data, never override tags: neutralise { } and backslashes, keep it on one line. */
export function assEscape(text: string): string {
  return text.replace(/\\/g, "＼").replace(/[{}]/g, "").replace(/\r?\n/g, " ").trim();
}

/** Split a line into punchy 1–3 word chunks (≤ 18 chars) for word-pop captions. */
export function chunkWords(line: string, maxWords = 3, maxChars = 18): string[] {
  const words = line.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    const next = [...cur, w].join(" ");
    if (cur.length && (cur.length >= maxWords || next.length > maxChars)) {
      chunks.push(cur.join(" "));
      cur = [w];
    } else cur.push(w);
  }
  if (cur.length) chunks.push(cur.join(" "));
  return chunks;
}

/** Spread chunks of each spoken line over its time window, weighted by length. */
export function kineticCues(lines: Array<{ start: number; end: number; text: string }>): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const line of lines) {
    const chunks = chunkWords(line.text);
    const total = chunks.reduce((n, c) => n + c.length + 2, 0) || 1;
    let t = line.start;
    for (const c of chunks) {
      const dur = ((line.end - line.start) * (c.length + 2)) / total;
      cues.push({ start: t, end: t + dur, text: c });
      t += dur;
    }
  }
  return cues;
}

const POP = "{\\fad(60,60)\\fscx70\\fscy70\\t(0,140,\\fscx112\\fscy112)\\t(140,260,\\fscx100\\fscy100)}";

/** Prices (₱…) and percentages pop in Guma yellow. */
function highlight(text: string): string {
  return assEscape(text).replace(/(₱\s?[\d,]+(?:\.\d+)?|\d+%(?:\s?OFF)?)/gi, "{\\c&H00D7FF&}$1{\\c&HFFFFFF&}");
}

export function buildAss(opts: {
  cues: SubtitleCue[];
  endCard: { start: number; end: number; lines: string[] };
  font: string;
}): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Kinetic,${opts.font},92,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,2,60,60,560,1`,
    `Style: EndCard,${opts.font},66,&H00FFFFFF,&H00FFFFFF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,3,18,0,8,60,60,300,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = opts.cues
    .filter((c) => c.start < opts.endCard.start)
    .map((c) => `Dialogue: 1,${assTime(c.start)},${assTime(Math.min(c.end, opts.endCard.start))},Kinetic,,0,0,0,,${POP}${highlight(c.text)}`);
  const card = opts.endCard.lines.map(assEscape).filter(Boolean).join("\\N");
  events.push(`Dialogue: 2,${assTime(opts.endCard.start)},${assTime(opts.endCard.end)},EndCard,,0,0,0,,{\\fad(200,0)}${card}`);
  return [...header, ...events, ""].join("\n");
}
