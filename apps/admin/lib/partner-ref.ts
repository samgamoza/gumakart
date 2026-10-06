"use client";

/**
 * Phase 18: remember a partner's referral code from /signup?partner=P-XXXXXX until the shop is
 * created (survives the Google sign-in round trip). 30 days, this browser only.
 */
const KEY = "gk-partner-ref";
const MAX_AGE_MS = 30 * 86_400_000;

export function capturePartnerRef(): string | null {
  try {
    const fromUrl = new URL(window.location.href).searchParams.get("partner");
    if (fromUrl && /^[A-Za-z0-9-]{6,16}$/.test(fromUrl)) {
      window.localStorage.setItem(KEY, JSON.stringify({ code: fromUrl.toUpperCase(), at: Date.now() }));
      return fromUrl.toUpperCase();
    }
    return readPartnerRef();
  } catch {
    return null;
  }
}

export function readPartnerRef(): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { code?: string; at?: number };
    if (!o.code || !o.at || Date.now() - o.at > MAX_AGE_MS) return null;
    return o.code;
  } catch {
    return null;
  }
}

export function clearPartnerRef(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
