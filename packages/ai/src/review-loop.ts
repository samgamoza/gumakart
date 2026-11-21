/**
 * AI suite Phase 4.3 — the BayanGo post-delivery review loop, in chat. Deterministic (no LLM):
 * the ask, reading the buyer's answer, and the thank-you with the voucher.
 */

const STAR_WORDS: Record<string, number> = {
  isa: 1, one: 1, dalawa: 2, two: 2, tatlo: 3, three: 3, apat: 4, four: 4, lima: 5, five: 5,
};

/**
 * The rating in a buyer's reply: "5", "5/5", "5 stars", "⭐⭐⭐⭐", "lima po", "10/10 super sarap" → 5.
 * Returns null when there's no clear 1–5 (so the message goes to the normal chat instead).
 */
export function parseReviewRating(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const stars = (t.match(/⭐|🌟|★/g) ?? []).length;
  if (stars >= 1 && stars <= 5) return stars;
  const outOf10 = t.match(/\b(10|[1-9])\s*\/\s*10\b/);
  if (outOf10) return Math.max(1, Math.min(5, Math.round(Number(outOf10[1]) / 2)));
  const outOf5 = t.match(/\b([1-5])\s*(?:\/\s*5|stars?|star|⭐)/);
  if (outOf5) return Number(outOf5[1]);
  const bare = t.match(/^([1-5])(?:[\s.!,)]|$)/);
  if (bare) return Number(bare[1]);
  const word = t.match(/^(isa|one|dalawa|two|tatlo|three|apat|four|lima|five)\b/);
  if (word) return STAR_WORDS[word[1]!] ?? null;
  return null;
}

/** What the buyer wrote besides the rating (kept as the review text). */
export function reviewBodyFrom(text: string): string | null {
  const body = text
    .replace(/⭐|🌟|★/g, "")
    .replace(/^\s*(?:10|[1-9])\s*\/\s*(?:10|5)\b/i, "")
    .replace(/^\s*[1-5]\s*(?:stars?|star)?\s*[.!,:-]?\s*/i, "")
    .replace(/^\s*(?:isa|one|dalawa|two|tatlo|three|apat|four|lima|five)\b\s*(?:stars?)?\s*(?:po)?\s*[.!,:-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return body.length >= 3 ? body.slice(0, 1000) : null;
}

export function reviewPromptText(input: { buyerName: string | null; shopName: string; item: string | null; reviewUrl: string | null }): string {
  const hi = input.buyerName?.trim().split(/\s+/)[0] ? `Hi ${input.buyerName.trim().split(/\s+/)[0]!.slice(0, 30)}!` : "Hi po!";
  const item = input.item ? ` ang ${input.item.slice(0, 60)}` : " ang order mo";
  return (
    `${hi} Na-deliver na po${item} from ${input.shopName.slice(0, 60)} 📦 Kumusta? ` +
    "Reply ka lang ng 1–5 ⭐ (5 = sobrang saya!) at pwede ka ring mag-send ng photo. " +
    "May thank-you voucher ka pagkatapos! 💛" +
    (input.reviewUrl ? `\nO dito ka mag-review: ${input.reviewUrl}` : "")
  );
}

export function reviewPhotoAckText(): string {
  return "Salamat sa photo! 📸 Ilang stars po ang bigay mo (1–5)?";
}

export function reviewThanksText(input: {
  rating: number;
  voucher: { code: string; amount: number; expiresAt: Date | null } | null;
  shopName: string;
}): string {
  const thanks = input.rating >= 4 ? "Maraming salamat sa review mo! 🥰 Naka-post na siya sa shop." : "Salamat sa honest review mo 🙏 Naka-post na, at babasahin ito ng seller para mas gumanda pa ang serbisyo.";
  if (!input.voucher) return thanks;
  const until = input.voucher.expiresAt
    ? ` hanggang ${input.voucher.expiresAt.toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" })}`
    : "";
  return (
    `${thanks}\n\nEto ang thank-you voucher mo: *${input.voucher.code}* — ₱${input.voucher.amount.toLocaleString("en-PH")} off sa next order sa ${input.shopName.slice(0, 60)}, ` +
    `valid${until}. Isang beses lang magagamit — pwede mo ring i-share sa kaibigan! 🎁`
  );
}
