"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Phase 22: saved items. The list lives on this device (per shop) so it works without an account;
 * each save is also sent to the server with an anonymous device id (or the Guma ID when signed in),
 * which is how sellers see real "most saved" counts.
 */
const listKey = (slug: string) => `guma-wish:${slug}`;
const DEVICE_KEY = "guma-device";
const EVENT = "guma-wish-change";

export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[a-zA-Z0-9-]{16,40}$/.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export function readWishlist(slug: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(listKey(slug)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  } catch {
    return [];
  }
}

function writeWishlist(slug: string, ids: string[]) {
  try {
    localStorage.setItem(listKey(slug), JSON.stringify(ids));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: slug }));
  } catch {
    /* private mode */
  }
}

export function useWishlist(slug: string) {
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sync = () => setIds(readWishlist(slug));
    sync();
    setReady(true);
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [slug]);

  const toggle = useCallback(
    (productId: string) => {
      const current = readWishlist(slug);
      const saved = !current.includes(productId);
      writeWishlist(slug, saved ? [...current, productId] : current.filter((id) => id !== productId));
      void fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantSlug: slug, productId, saved, deviceId: deviceId() }),
      }).catch(() => undefined);
      return saved;
    },
    [slug]
  );

  /** Merge what the server knows (e.g. saved on another phone with the same Guma ID). */
  const mergeFromServer = useCallback(
    (serverIds: string[]) => {
      const current = readWishlist(slug);
      const merged = [...new Set([...current, ...serverIds])];
      if (merged.length !== current.length) writeWishlist(slug, merged);
    },
    [slug]
  );

  return { ids, ready, toggle, mergeFromServer };
}
