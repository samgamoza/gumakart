"use client";

import { useEffect } from "react";
import { sanitizeUtm } from "@/lib/utm";

/**
 * Phase 13: remember where the buyer came from (?ref=tiktok, utm_source, fbclid, ttclid,
 * th=<chat thread>) for this tab, so a storefront order made a few pages later is still
 * credited to TikTok / Instagram / the Messenger chat. Last click wins; sessionStorage only.
 */
const keyFor = (slug: string) => `gk-utm:${slug}`;

export function AttributionCapture({ tenantSlug }: { tenantSlug: string }) {
  useEffect(() => {
    try {
      const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
      const utm = sanitizeUtm(params);
      if (utm) sessionStorage.setItem(keyFor(tenantSlug), JSON.stringify(utm));
    } catch {
      /* storage blocked: attribution is best-effort */
    }
  }, [tenantSlug]);
  return null;
}

export function storedUtm(tenantSlug: string): Record<string, string> | undefined {
  try {
    const raw = sessionStorage.getItem(keyFor(tenantSlug));
    return raw ? (sanitizeUtm(JSON.parse(raw)) ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}
