/**
 * Comment-to-DM keyword matching (AI suite Phase 3). Filipino sellers' buyers comment "HM",
 * "hm po", "magkano", "mine!", "avail pa?", "pa-PM", "dets"… Matching is case- and
 * punctuation-insensitive, knows common Taglish variants of each default keyword, and forgives
 * one typo on longer words ("magkanu", "availble").
 */
const GROUPS: Record<string, string[]> = {
  hm: ["hm", "hmm", "hmp", "how much", "magkano", "magkanu", "mgkano", "price", "presyo", "pila", "hm po", "how much po"],
  mine: ["mine", "mine po", "akin", "akin na", "sakin", "kuha", "kunin ko", "reserve"],
  avail: ["avail", "available", "available pa", "avail pa", "meron pa", "may stock", "stock", "onhand", "on hand"],
  details: ["details", "dets", "info", "pm", "pa pm", "pm po", "pm me", "pls pm", "interested", "inquire"],
  order: ["order", "orderin", "order po", "bili", "bibili", "buy", "checkout"],
};

export function normalizeCommentText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9?\s]+/g, " ")
    .replace(/\?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Does the normalized comment contain this phrase (as whole words, typo-tolerant for ≥6 letters)? */
function containsPhrase(words: string[], phrase: string): boolean {
  const target = normalizeCommentText(phrase).split(" ").filter(Boolean);
  if (!target.length) return false;
  for (let i = 0; i + target.length <= words.length; i += 1) {
    if (target.every((t, k) => words[i + k] === t || (t.length >= 6 && editDistanceAtMost1(words[i + k]!, t)))) return true;
  }
  return false;
}

/** Expand a seller keyword with its Taglish variants when it belongs to a known group. */
export function expandKeyword(keyword: string): string[] {
  const k = normalizeCommentText(keyword);
  for (const variants of Object.values(GROUPS)) {
    if (variants.some((v) => normalizeCommentText(v) === k)) return variants;
  }
  return [keyword];
}

/** The seller keyword this comment matches, or null. Very long comments (rants, essays) don't trigger. */
export function matchCommentTrigger(text: string, keywords: string[]): string | null {
  const norm = normalizeCommentText(text);
  if (!norm || norm.length > 280) return null;
  const words = norm.split(" ");
  for (const kw of keywords) {
    if (!kw.trim()) continue;
    if (expandKeyword(kw).some((v) => containsPhrase(words, v))) return kw;
  }
  return null;
}

/** Rotate public replies so the Page doesn't post the identical line under every comment. */
export function pickPublicReply(templates: string[], seed: string): string {
  const list = templates.map((t) => t.trim()).filter(Boolean);
  if (!list.length) return "Sent you a DM po! Check your message requests 💌";
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length]!;
}
