/** Attribution params we keep from a shared link (?utm_source=facebook&fbclid=…). */
const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "ttclid",
  "igshid",
  // Phase 13: channel tag added by Guma's share buttons (?ref=tiktok) and the chat thread a
  // link was sent in (?th=<id>, so the order shows in that Messenger/Instagram conversation).
  "ref",
  "th",
] as const;

export function sanitizeUtm(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim().slice(0, 200);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function utmFromSearchParams(params: Record<string, string | string[] | undefined>): Record<string, string> | null {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") flat[key] = value;
    else if (Array.isArray(value) && value[0]) flat[key] = value[0];
  }
  return sanitizeUtm(flat);
}

/** Link-preview crawlers (Messenger, WhatsApp, Viber…) shouldn't count as views. */
export function isPreviewBot(userAgent: string | null): boolean {
  if (!userAgent) return true;
  return /facebookexternalhit|facebot|meta-externalagent|whatsapp|viber|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|skypeuripreview|googlebot|bingbot|applebot|bot\b|crawler|spider|preview/i.test(
    userAgent
  );
}
