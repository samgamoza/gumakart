/**
 * Phase 13 — where a sale came from, as a seller thinks about it ("TikTok", "Messenger",
 * "Shopee"), separate from the surface it was placed on (orders.source_channel = storefront /
 * checkout_link / pos / marketplace / chat).
 *
 * Decided once when the order is created, from (strongest first):
 *  1. an explicit channel (POS, marketplace import, an order made from a Messenger chat);
 *  2. `ref` on the shared link (?ref=tiktok — what Guma's share buttons add);
 *  3. utm_source;
 *  4. click ids the apps add on their own (ttclid → TikTok, igshid → Instagram,
 *     fbclid → Facebook);
 *  5. the channel the seller picked when sharing the checkout link;
 *  6. otherwise "direct".
 */

export const SALES_CHANNELS = ["facebook", "instagram", "messenger", "tiktok", "shopee", "lazada", "sms", "pos", "direct", "other"] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

export const SALES_CHANNEL_LABELS: Record<SalesChannel, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  messenger: "Messenger",
  tiktok: "TikTok",
  shopee: "Shopee",
  lazada: "Lazada",
  sms: "SMS campaigns",
  pos: "In store (POS)",
  direct: "Direct / other links",
  other: "Other",
};

/** Channels a seller can tag a shared link with (?ref=…). */
export const SHARE_REF_CHANNELS: SalesChannel[] = ["facebook", "instagram", "messenger", "tiktok", "other"];

const ALIASES: Record<string, SalesChannel> = {
  fb: "facebook",
  facebook: "facebook",
  "facebook.com": "facebook",
  "m.facebook.com": "facebook",
  "l.facebook.com": "facebook",
  fbpage: "facebook",
  fbgroup: "facebook",
  marketplace: "facebook",
  ig: "instagram",
  insta: "instagram",
  instagram: "instagram",
  "instagram.com": "instagram",
  messenger: "messenger",
  msgr: "messenger",
  "m.me": "messenger",
  tiktok: "tiktok",
  tt: "tiktok",
  "tiktok.com": "tiktok",
  shopee: "shopee",
  lazada: "lazada",
  sms: "sms",
  text: "sms",
  other: "other",
};

export function normalizeSalesChannel(value: string | null | undefined): SalesChannel | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  if ((SALES_CHANNELS as readonly string[]).includes(v)) return v as SalesChannel;
  return ALIASES[v] ?? null;
}

export function salesChannelOf(input: {
  explicit?: string | null;
  sourceChannel?: string | null;
  utm?: Record<string, string> | null;
  shareChannel?: string | null;
}): SalesChannel {
  const explicit = normalizeSalesChannel(input.explicit);
  if (explicit) return explicit;
  if (input.sourceChannel === "pos") return "pos";
  const utm = input.utm ?? {};
  const fromRef = normalizeSalesChannel(utm.ref);
  if (fromRef) return fromRef;
  const fromSource = normalizeSalesChannel(utm.utm_source);
  if (fromSource) return fromSource;
  if (utm.ttclid) return "tiktok";
  if (utm.igshid) return "instagram";
  if (utm.fbclid) return "facebook";
  const shared = normalizeSalesChannel(input.shareChannel);
  if (shared) return shared;
  return "direct";
}

/** A shared URL tagged for a channel (keeps any existing query; replaces an old ref). */
export function withChannelRef(url: string, channel: SalesChannel): string {
  const absolute = /^https?:\/\//i.test(url);
  const u = new URL(url, "https://x.invalid");
  u.searchParams.set("ref", channel);
  return absolute ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
}
