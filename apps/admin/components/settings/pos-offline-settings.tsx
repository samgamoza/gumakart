"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, WifiOff } from "lucide-react";
import { Button } from "@gumakart/ui";
import { SettingsCard } from "@/components/settings/settings-forms";
import { useShopRole } from "@/lib/use-shop-role";

/**
 * Phase 12b — POS offline mode, owner side.
 *  - Offline sales to check: what the server flagged when a sale rung without internet
 *    synced (stock ran short, price changed, invoice number changed, landed after a shift
 *    close or Z reading, or couldn't be saved as a sale at all — the full sale is kept).
 *  - Offline invoice numbers (BIR on): each register device's reserved block, how much is
 *    used, and "Release" for a lost or retired device.
 */

interface Issue {
  id: string;
  kind: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  detail: Record<string, unknown> | null;
}

interface Block {
  id: string;
  deviceId: string;
  from: string;
  to: string;
  used: number;
  size: number;
  createdAt: string;
  releasedAt: string | null;
}

const LABEL: Record<string, string> = {
  stock_short: "Stock ran short",
  price_changed: "Price changed",
  unavailable: "Item no longer for sale",
  invoice_reassigned: "Invoice no. changed",
  closed_shift: "After shift close",
  after_z: "After Z reading",
  rejected: "Not saved as a sale",
};

const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function OfflineSalesCard() {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/pos/offline/issues${showAll ? "?all=1" : ""}`, { cache: "no-store" });
    const d = (await res.json().catch(() => ({}))) as { ok?: boolean; issues?: Issue[]; error?: string };
    if (!d.ok) return setError(d.error ?? "Could not load.");
    setIssues(d.issues ?? []);
  }, [showAll]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SettingsCard title="Offline sales">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
        When the internet drops, the register keeps selling and sends the sales when it&apos;s back. Anything that changed in between shows here.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!issues ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : issues.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-emerald-600" data-testid="offline-none">
          <CheckCircle2 className="h-4 w-4" /> Nothing to check.
        </p>
      ) : (
        <ul className="divide-y divide-border text-sm" data-testid="offline-issues">
          {issues.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">{LABEL[i.kind] ?? i.kind}</span>
                <span className="block">{i.message}</span>
                <span className="block text-xs text-muted-foreground">
                  {when(i.createdAt)}
                  {i.resolvedAt ? ` · checked by ${i.resolvedByName ?? "someone"}` : ""}
                </span>
                {i.kind === "rejected" && i.detail && (
                  <details className="mt-1 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">What was sold</summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">
                      {JSON.stringify({ items: i.detail.items, tenders: i.detail.tenders, customer: i.detail.customer }, null, 1)}
                    </pre>
                  </details>
                )}
              </span>
              {!i.resolvedAt && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    const res = await fetch("/api/pos/offline/issues", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ id: i.id }),
                    });
                    if (res.ok) await load();
                  }}
                >
                  Checked
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowAll((v) => !v)}>
        {showAll ? "Show only to check" : "Show checked too"}
      </button>
    </SettingsCard>
  );
}

/** Inside the BIR card: blocks of invoice numbers reserved by register devices for offline use. */
export function OfflineInvoiceBlocks() {
  const perms = useShopRole();
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/bir/blocks", { cache: "no-store" });
    const d = (await res.json().catch(() => ({}))) as { ok?: boolean; blocks?: Block[]; error?: string };
    if (d.ok) setBlocks(d.blocks ?? []);
    else setError(d.error ?? "Could not load.");
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!blocks || blocks.length === 0) {
    return (
      <div className="space-y-1 border-t border-border pt-4 text-sm">
        <p className="font-semibold">Offline invoice numbers</p>
        <p className="text-xs text-muted-foreground">
          Each register keeps a small block of numbers so receipts printed without internet still have a real, never-reused number. A block is reserved the next time a register opens online.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2 border-t border-border pt-4 text-sm" data-testid="offline-blocks">
      <p className="font-semibold">Offline invoice numbers</p>
      <p className="text-xs text-muted-foreground">
        Reserved per register device. Numbers inside a block are used in order when that device is offline, so they can come before later online numbers. Release a block only when the device is lost or retired — its unused numbers are then never issued (note them for your accountant).
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <ul className="divide-y divide-border">
        {blocks.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {b.from} – {b.to}
              <span className="block text-xs text-muted-foreground">
                Device …{b.deviceId.slice(-6)} · {b.used}/{b.size} used · {when(b.createdAt)}
                {b.releasedAt ? ` · released ${when(b.releasedAt)}` : ""}
              </span>
            </span>
            {!b.releasedAt && perms.role === "owner" && b.used < b.size && (
              confirm === b.id ? (
                <span className="flex items-center gap-2 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> {b.size - b.used} numbers won&apos;t be used.
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      const res = await fetch("/api/bir/blocks", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ blockId: b.id }),
                      });
                      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
                      if (!d.ok) setError(d.error ?? "Could not release.");
                      setConfirm(null);
                      await load();
                    }}
                  >
                    Release
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(b.id)}>
                  Release…
                </Button>
              )
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
