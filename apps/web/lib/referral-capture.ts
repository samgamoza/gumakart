"use client";

/**
 * Phase 32: remember a Suki referral code from a shared link (?ref=suki&code=CODE) on this device for 30 days,
 * per shop, so it rides along with the buyer's first order. The server decides whether it counts.
 */
const key = (slug: string) => `guma-ref:${slug}`;
const TTL = 30 * 86_400_000;

export function captureReferral(slug: string): void {
  try {
    // `ref` is also used for traffic sources (?ref=sms, ?ref=tiktok) — only a Suki code shape counts,
    // so those never overwrite a friend's code.
    const q = new URLSearchParams(window.location.search);
    const code = (q.get("code") ?? q.get("ref") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^S[A-Z0-9]{6}$/.test(code)) return;
    localStorage.setItem(key(slug), JSON.stringify({ code, at: Date.now() }));
  } catch {
    /* private mode */
  }
}

export function readReferral(slug: string): string | undefined {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return undefined;
    const v = JSON.parse(raw) as { code?: string; at?: number };
    if (!v.code || !v.at || Date.now() - v.at > TTL) return undefined;
    return v.code;
  } catch {
    return undefined;
  }
}
