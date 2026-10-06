/**
 * Phase 27: Suki loyalty — the rules, pure (shared by the admin app, the buyer site and tests).
 *
 *  - Buyers earn points on paid orders: 1 point per `pesoPerPoint` spent on items (delivery fee,
 *    gift-card/store-credit payments and refunds don't earn), times their tier's multiplier.
 *  - Tier = what they spent at this shop in the last 12 months.
 *  - Points convert to store credit (the Phase 17 store-credit cards), never to cash.
 * Idea from the palenkeAi prototype ("Suki tiers"), kept on the server so points survive a new phone.
 */

export const SUKI_TIERS = ["bronze", "silver", "gold", "platinum"] as const;
export type SukiTier = (typeof SUKI_TIERS)[number];

export const SUKI_TIER_LABELS: Record<SukiTier, string> = {
  bronze: "Suki Bronze",
  silver: "Suki Silver",
  gold: "Suki Gold",
  platinum: "Suki Platinum",
};

export const SUKI_MULTIPLIERS: Record<SukiTier, number> = { bronze: 1, silver: 1.25, gold: 1.5, platinum: 2 };

export interface TenantLoyaltySettings {
  enabled?: boolean;
  /** When the shop turned it on — only orders after this earn. ISO string. */
  enabledAt?: string;
  /** Pesos spent per 1 point (₱20–₱1,000). Default ₱100. */
  pesoPerPoint?: number;
  /** Store credit per point in pesos (₱0.10–₱5). Default ₱1. */
  pointValue?: number;
  /** Fewest points a buyer can convert at once. Default 50. */
  minRedeem?: number;
  /** 12-month spend needed for silver / gold / platinum. */
  tiers?: { silver?: number; gold?: number; platinum?: number };
  /** Phase 32: buyer referrals ("give ₱50, get ₱50"), paid as store credit. */
  referral?: { enabled?: boolean; referrerReward?: number; friendReward?: number; minOrder?: number; monthlyCap?: number };
}

export interface ReferralRules {
  enabled: boolean;
  referrerReward: number;
  friendReward: number;
  /** The friend's first order (items, after discount) must be at least this. */
  minOrder: number;
  /** Most rewarded referrals per referrer per calendar month (Manila). */
  monthlyCap: number;
}

export const REFERRAL_DEFAULTS: ReferralRules = { enabled: false, referrerReward: 50, friendReward: 50, minOrder: 300, monthlyCap: 10 };

export function referralRules(s: TenantLoyaltySettings | null | undefined): ReferralRules {
  const r = s?.referral;
  const d = REFERRAL_DEFAULTS;
  return {
    enabled: r?.enabled === true,
    referrerReward: Math.round(clampNum(r?.referrerReward, 0, 5000, d.referrerReward) * 100) / 100,
    friendReward: Math.round(clampNum(r?.friendReward, 0, 5000, d.friendReward) * 100) / 100,
    minOrder: Math.round(clampNum(r?.minOrder, 0, 1_000_000, d.minOrder)),
    monthlyCap: Math.round(clampNum(r?.monthlyCap, 1, 100, d.monthlyCap)),
  };
}

/** Referral codes avoid look-alike characters (no 0/O, 1/I/L). */
export function newReferralCode(): string {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return `S${[...bytes].map((b) => A[b % A.length]).join("")}`;
}

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const c = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^S[A-Z0-9]{6}$/.test(c) ? c : null;
}

export interface LoyaltyRules {
  enabled: boolean;
  enabledAt: string | null;
  pesoPerPoint: number;
  pointValue: number;
  minRedeem: number;
  tiers: { silver: number; gold: number; platinum: number };
}

export const LOYALTY_DEFAULTS: LoyaltyRules = {
  enabled: false,
  enabledAt: null,
  pesoPerPoint: 100,
  pointValue: 1,
  minRedeem: 50,
  tiers: { silver: 5_000, gold: 15_000, platinum: 40_000 },
};

const clampNum = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Settings JSON → complete, safe rules (missing or bad values fall back to defaults). */
export function loyaltyRules(s: TenantLoyaltySettings | null | undefined): LoyaltyRules {
  const d = LOYALTY_DEFAULTS;
  const silver = Math.round(clampNum(s?.tiers?.silver, 100, 10_000_000, d.tiers.silver));
  const gold = Math.max(silver + 1, Math.round(clampNum(s?.tiers?.gold, 100, 10_000_000, d.tiers.gold)));
  const platinum = Math.max(gold + 1, Math.round(clampNum(s?.tiers?.platinum, 100, 10_000_000, d.tiers.platinum)));
  return {
    enabled: s?.enabled === true,
    enabledAt: typeof s?.enabledAt === "string" ? s.enabledAt : null,
    pesoPerPoint: Math.round(clampNum(s?.pesoPerPoint, 20, 1000, d.pesoPerPoint)),
    pointValue: Math.round(clampNum(s?.pointValue, 0.1, 5, d.pointValue) * 100) / 100,
    minRedeem: Math.round(clampNum(s?.minRedeem, 1, 100_000, d.minRedeem)),
    tiers: { silver, gold, platinum },
  };
}

export function tierFor(spend12m: number, rules: LoyaltyRules): SukiTier {
  if (spend12m >= rules.tiers.platinum) return "platinum";
  if (spend12m >= rules.tiers.gold) return "gold";
  if (spend12m >= rules.tiers.silver) return "silver";
  return "bronze";
}

/** The next tier and how much more spend it needs (null at platinum). */
export function nextTier(spend12m: number, rules: LoyaltyRules): { tier: SukiTier; needed: number } | null {
  const current = tierFor(spend12m, rules);
  const order: SukiTier[] = ["bronze", "silver", "gold", "platinum"];
  const next = order[order.indexOf(current) + 1];
  if (!next) return null;
  const threshold = rules.tiers[next as Exclude<SukiTier, "bronze">];
  return { tier: next, needed: Math.max(0, Math.round((threshold - spend12m) * 100) / 100) };
}

/** Points for one order's earning amount at a tier. */
export function pointsFor(earnAmount: number, tier: SukiTier, rules: LoyaltyRules): number {
  if (!(earnAmount > 0)) return 0;
  return Math.floor(Math.floor(earnAmount / rules.pesoPerPoint) * SUKI_MULTIPLIERS[tier]);
}

/** Store credit (₱) for converting `points`. */
export function creditFor(points: number, rules: LoyaltyRules): number {
  return Math.round(points * rules.pointValue * 100) / 100;
}
