"use client";

import { useCallback, useEffect, useState } from "react";
import { Handshake, Loader2, ShieldCheck } from "lucide-react";
import { Button, Card } from "@gumakart/ui";
import { SettingsPageLayout } from "@/components/settings/settings-shell";

/**
 * Phase 18 — owner only. Give an agency partner access to help run the shop (as Manager or Staff),
 * see who has access, remove it any time. Partners never get payments, plan, staff or API keys.
 */

type View = {
  access: { partnerId: string; name: string; code: string; role: "manager" | "staff"; grantedAt: string | null; lastOpenedAt: string | null; contactEmail: string; website: string | null } | null;
  referredBy: { partnerId: string; name: string; code: string; status: string } | null;
};
type Preview = { name: string; code: string; city: string | null; website: string | null; approved: boolean };

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "never");

export function PartnerSettingsPage() {
  const [view, setView] = useState<View | null>(null);
  const [code, setCode] = useState("");
  const [role, setRole] = useState<"manager" | "staff">("manager");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/shop-partner", { cache: "no-store" }).then((r) => r.json());
    if (d.ok) setView({ access: d.access, referredBy: d.referredBy });
    else setMsg({ text: d.error ?? "Could not load.", ok: false });
  }, []);
  useEffect(() => void load(), [load]);

  async function check(c = code) {
    setMsg(null);
    setPreview(null);
    if (c.trim().length < 6) return;
    const d = await fetch(`/api/shop-partner?code=${encodeURIComponent(c.trim())}`).then((r) => r.json());
    if (d.ok) setPreview(d.preview);
    else setMsg({ text: d.error ?? "No partner with that code.", ok: false });
  }

  // Show who the code belongs to as soon as it's complete (P-XXXXXX).
  useEffect(() => {
    const c = code.trim();
    if (!/^P-?[A-Z0-9]{6}$/.test(c)) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => void check(c), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function grant(withCode = code) {
    setBusy(true);
    setMsg(null);
    const d = await fetch("/api/shop-partner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: withCode.trim(), role }) }).then((r) => r.json());
    setBusy(false);
    if (!d.ok) return setMsg({ text: d.error ?? "Could not add the partner.", ok: false });
    setView({ access: d.access, referredBy: d.referredBy });
    setCode("");
    setPreview(null);
    setMsg({ text: `${d.access?.name ?? "The partner"} can now help in your shop.`, ok: true });
  }

  async function revoke() {
    if (!view?.access) return;
    setBusy(true);
    const d = await fetch("/api/shop-partner", { method: "DELETE" }).then((r) => r.json());
    setBusy(false);
    if (!d.ok) return setMsg({ text: d.error ?? "Could not remove.", ok: false });
    setView({ access: d.access, referredBy: d.referredBy });
    setMsg({ text: "Access removed. The partner is signed out of your shop right away.", ok: true });
  }

  return (
    <SettingsPageLayout title="Partner" description="Let an agency or VA help run your shop — without sharing your password. You can remove them any time.">
      <div className="mx-auto max-w-3xl space-y-4 pb-24">
        {!view && (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        )}
        {msg && <p className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-500/10 text-emerald-200" : "bg-rose-500/10 text-rose-200"}`}>{msg.text}</p>}

        {view?.access ? (
          <div data-testid="partner-access">
          <Card className="space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <Handshake className="mt-0.5 h-5 w-5 text-sky-300" />
                <div>
                  <p className="font-semibold text-white">{view.access.name}</p>
                  <p className="text-sm text-slate-400">
                    {view.access.role === "manager" ? "Manager" : "Staff"} access · since {day(view.access.grantedAt)} · last opened {day(view.access.lastOpenedAt)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {view.access.contactEmail}
                    {view.access.website ? ` · ${view.access.website}` : ""} · code {view.access.code}
                  </p>
                </div>
              </div>
              <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void revoke()} data-testid="partner-revoke">
                Remove access
              </Button>
            </div>
            <p className="text-xs text-slate-400">What they do shows in Settings → Activity, marked as partner.</p>
          </Card>
          </div>
        ) : (
          view && (
            <div data-testid="partner-add">
            <Card className="space-y-4 p-5">
              <h2 className="flex items-center gap-2 font-semibold text-white">
                <Handshake className="h-4 w-4 text-sky-300" /> Add a partner
              </h2>
              {view.referredBy && view.referredBy.status === "active" && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
                  <span>
                    You signed up through <strong>{view.referredBy.name}</strong>. Give them access?
                  </span>
                  <Button type="button" size="sm" disabled={busy} onClick={() => void grant(view.referredBy!.code)}>
                    Give {role === "manager" ? "Manager" : "Staff"} access
                  </Button>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <label className="text-sm">
                  <span className="text-slate-400">Partner code (ask your agency)</span>
                  <input
                    className="guma-field mt-1 h-10 w-full font-mono uppercase"
                    placeholder="P-XXXXXX"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    data-testid="partner-code-input"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-slate-400">Access</span>
                  <select className="guma-field mt-1 h-10 w-full" value={role} onChange={(e) => setRole(e.target.value as "manager" | "staff")}>
                    <option value="manager">Manager — products, orders, marketing, reports</option>
                    <option value="staff">Staff — orders and stock only</option>
                  </select>
                </label>
              </div>
              {preview && (
                <p className="rounded-xl bg-white/5 px-3 py-2 text-sm" data-testid="partner-preview">
                  <strong className="text-white">{preview.name}</strong>
                  {preview.city ? ` · ${preview.city}` : ""}
                  {preview.website ? ` · ${preview.website}` : ""}
                  {!preview.approved && <span className="text-amber-300"> — not approved by Guma Kart yet</span>}
                </p>
              )}
              <ul className="space-y-1 text-xs text-slate-400">
                <li className="flex items-start gap-1.5">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /> Partners never see or change your payment details, plan, staff or API keys.
                </li>
                <li className="flex items-start gap-1.5">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /> One partner at a time. Removing access works instantly.
                </li>
              </ul>
              <Button type="button" disabled={busy || code.trim().length < 6} onClick={() => void grant()} data-testid="partner-grant">
                {busy ? "Adding…" : "Give access"}
              </Button>
            </Card>
            </div>
          )
        )}
      </div>
    </SettingsPageLayout>
  );
}
