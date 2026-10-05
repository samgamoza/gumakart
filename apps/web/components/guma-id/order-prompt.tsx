"use client";

import Link from "next/link";
import { useState } from "react";
import { GumaIdSignIn } from "./sign-in";
import { useGumaId } from "./use-guma-id";

/** Phase 12: on the order page — keep this and future orders in Guma ID. */
export function GumaIdOrderPrompt() {
  const gid = useGumaId();
  const [open, setOpen] = useState(false);
  if (!gid.loaded || !gid.available) return null;
  if (gid.buyer) {
    return (
      <Link href="/account" className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-800" data-testid="guma-id-orders-link">
        Lahat ng order mo sa Guma ID →
      </Link>
    );
  }
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm" data-testid="guma-id-order-prompt">
      {!open ? (
        <button type="button" className="w-full text-left" onClick={() => setOpen(true)}>
          <span className="font-semibold">⚡ Mas mabilis sa susunod</span>
          <span className="block text-neutral-500">I-verify ang number mo sa Guma ID: auto-fill sa lahat ng Guma Kart shops at makita ang lahat ng order mo.</span>
        </button>
      ) : (
        <GumaIdSignIn compact onSignedIn={() => { window.location.assign("/account"); }} />
      )}
    </div>
  );
}
