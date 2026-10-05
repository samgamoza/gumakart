"use client";

import { useEffect, useState } from "react";
import { can, shopRoleOf, type Permission, type ShopRole } from "@gumakart/db/staff-permissions";

let cached: ShopRole | null | undefined;
let inflight: Promise<ShopRole | null> | null = null;

function fetchRole(): Promise<ShopRole | null> {
  inflight ??= fetch("/api/auth/session", { cache: "no-store" })
    .then((r) => r.json())
    .then((d: { ok?: boolean; user?: { role: string; staffRole?: string | null }; supportAccess?: boolean }) =>
      d.ok && d.user ? shopRoleOf({ ...d.user, supportAccess: d.supportAccess }) : null
    )
    .catch(() => null)
    .then((role) => {
      cached = role;
      return role;
    });
  return inflight;
}

/**
 * Phase 10: the signed-in person's shop role, for hiding buttons they can't use.
 * Display only — the API enforces the same rules. Until loaded, behaves as owner
 * so owners (most sellers) never see a flicker.
 */
export function useShopRole(): { role: ShopRole | null; loaded: boolean; can: (p: Permission) => boolean } {
  const [role, setRole] = useState<ShopRole | null | undefined>(cached);
  useEffect(() => {
    if (cached !== undefined) return;
    let alive = true;
    void fetchRole().then((r) => alive && setRole(r));
    return () => {
      alive = false;
    };
  }, []);
  const effective = role === undefined ? "owner" : role;
  return { role: effective, loaded: role !== undefined, can: (p) => can(effective, p) };
}
