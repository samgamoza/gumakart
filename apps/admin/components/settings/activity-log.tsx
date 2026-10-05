"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { SettingsShell } from "@/components/settings/settings-shell";
import { SettingsCard } from "@/components/settings/settings-forms";

interface Row {
  id: string;
  actorUserId: string | null;
  actorName: string;
  actorRole: string | null;
  action: string;
  summary: string;
  createdAt: string;
}

const KINDS: Array<{ id: string; label: string }> = [
  { id: "", label: "Everything" },
  { id: "order", label: "Orders & payments" },
  { id: "product", label: "Products & prices" },
  { id: "stock", label: "Stock" },
  { id: "staff", label: "Staff" },
  { id: "pos", label: "POS" },
  { id: "settings", label: "Settings" },
  { id: "link", label: "Checkout links" },
];

const ROLE_TAG: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
  cashier: "Cashier",
  support: "Guma support",
  pos_manager: "POS PIN",
  pos_cashier: "POS PIN",
};

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Phase 10: who did what — owners and managers only. */
export function ActivityLogPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [kind, setKind] = useState("");
  const [actor, setActor] = useState("");
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (append = false, before?: string) => {
      const q = new URLSearchParams();
      if (kind) q.set("kind", kind);
      if (actor) q.set("actor", actor);
      if (before) q.set("before", before);
      const res = await fetch(`/api/activity?${q}`, { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; error?: string; rows?: Row[] };
      if (!data.ok) {
        setError(data.error ?? "Could not load activity.");
        setRows((r) => r ?? []);
        return;
      }
      const next = data.rows ?? [];
      setRows((r) => (append && r ? [...r, ...next] : next));
      setMore(next.length === 50);
    },
    [kind, actor]
  );

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  const people = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows ?? []) if (r.actorUserId) map.set(r.actorUserId, r.actorName);
    return [...map.entries()];
  }, [rows]);

  return (
    <SettingsShell title="Activity" description="Who confirmed payments, refunded, changed prices or stock, and managed staff — newest first.">
      <SettingsCard title="Shop activity">
        <div className="flex flex-wrap items-center gap-2">
          <select className="guma-field h-9 w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of activity">
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <select className="guma-field h-9 w-auto" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Person">
            <option value="">Everyone</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        {rows === null ? (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing yet. Actions by you and your staff will show here.</p>
        ) : (
          <ul className="divide-y divide-white/[0.06]" data-testid="activity-list">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5 text-sm">
                <span className="w-32 flex-none text-xs text-slate-500">{when(r.createdAt)}</span>
                <span className="font-medium text-slate-100">
                  {r.actorName}
                  {r.actorRole && ROLE_TAG[r.actorRole] ? (
                    <span className="ml-1.5 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                      {ROLE_TAG[r.actorRole]}
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 text-slate-300">{r.summary}</span>
              </li>
            ))}
          </ul>
        )}
        {more && rows && (
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={() => void load(true, rows[rows.length - 1]!.createdAt)}
          >
            Show older
          </button>
        )}
      </SettingsCard>
    </SettingsShell>
  );
}
