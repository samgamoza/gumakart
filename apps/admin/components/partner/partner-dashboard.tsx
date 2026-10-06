"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Handshake, Loader2, LogOut, Store } from "lucide-react";
import { GumaLogo } from "@gumakart/ui";
import { adminUrl } from "@/lib/utils";
import { TwoFactorCard } from "@/components/settings/two-factor-card";

type Shop = {
  tenantId: string;
  name: string;
  slug: string;
  source: "referral" | "grant";
  role: "manager" | "staff" | null;
  linkedAt: string;
  lastOpenedAt: string | null;
  stats: { orders30d: number; sales30d: number; plan: string; status: string } | null;
};
type Partner = { name: string; code: string; status: "pending" | "active" | "suspended"; statusNote: string | null; contactEmail: string; phone: string | null; website: string | null; city: string | null; about: string | null };

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—");

/** Phase 18: the agency partner's home — client shops, referral link, profile. */
export function PartnerDashboard() {
  const [data, setData] = useState<{ me: { displayName: string; email: string }; partner: Partner; shops: Shop[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState({ name: "", phone: "", website: "", city: "", about: "" });

  async function load() {
    const d = await fetch("/api/partner/me", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (!d?.ok) return setError(d?.error ?? "Couldn't load your partner account.");
    setData(d);
    const p = d.partner as Partner;
    setProfile({ name: p.name, phone: p.phone ?? "", website: p.website ?? "", city: p.city ?? "", about: p.about ?? "" });
  }
  useEffect(() => {
    void load();
  }, []);

  async function open(tenantId: string) {
    setOpening(tenantId);
    setError(null);
    const d = await fetch("/api/partner/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId }) })
      .then((r) => r.json())
      .catch(() => null);
    if (!d?.ok) {
      setOpening(null);
      setError(d?.error ?? "Couldn't open that shop.");
      return void load();
    }
    window.location.href = d.redirectTo ?? "/";
  }

  async function saveProfile() {
    const d = await fetch("/api/partner/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) }).then((r) => r.json());
    if (!d.ok) return setError(d.error ?? "Couldn't save.");
    setEditing(false);
    await load();
  }

  function copy(text: string, key: string) {
    void navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const p = data?.partner;
  const refLink = p ? `${adminUrl}/signup?partner=${p.code}` : "";
  const withAccess = data?.shops.filter((s) => s.role) ?? [];
  const referralOnly = data?.shops.filter((s) => !s.role) ?? [];

  return (
    <div className="min-h-screen bg-guma-navy text-slate-200">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <GumaLogo on="dark" className="h-9" />
            <span className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-0.5 text-xs font-semibold text-sky-200">Partner</span>
          </div>
          <button type="button" onClick={() => void logout()} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        {!data && !error && (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        )}
        {error && <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
        {p && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="font-display text-2xl font-bold text-white">{p.name}</h1>
                <p className="text-sm text-slate-400">Signed in as {data!.me.displayName} · {data!.me.email}</p>
              </div>
              <button type="button" className="text-sm text-slate-300 underline" onClick={() => setEditing((v) => !v)}>
                {editing ? "Close" : "Edit profile"}
              </button>
            </div>

            {p.status === "pending" && (
              <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100" data-testid="partner-pending">
                Your partner account is waiting for Guma Kart approval (usually 1–2 working days). You can already share your referral link; shops can give you access once you're approved.
              </p>
            )}
            {p.status === "suspended" && (
              <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                Your partner account is suspended{p.statusNote ? `: ${p.statusNote}` : "."} Contact Guma Kart support.
              </p>
            )}

            {editing && (
              <section className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-2">
                {(
                  [
                    ["name", "Agency name"],
                    ["phone", "Mobile"],
                    ["website", "Website / Facebook page"],
                    ["city", "City"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="text-sm">
                    <span className="text-slate-400">{label}</span>
                    <input className="guma-field mt-1 h-10 w-full" value={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} />
                  </label>
                ))}
                <label className="text-sm sm:col-span-2">
                  <span className="text-slate-400">What you do for shops</span>
                  <textarea className="guma-field mt-1 w-full py-2" rows={2} maxLength={500} value={profile.about} onChange={(e) => setProfile({ ...profile, about: e.target.value })} />
                </label>
                <div className="sm:col-span-2">
                  <button type="button" onClick={() => void saveProfile()} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white">
                    Save profile
                  </button>
                </div>
              </section>
            )}

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Your partner code</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded-lg bg-black/30 px-3 py-1.5 font-mono text-lg tracking-widest text-white" data-testid="partner-code">{p.code}</span>
                  <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-xs" onClick={() => copy(p.code, "code")}>
                    {copied === "code" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-400">Clients enter this in <strong>Settings → Partner</strong> to give you access. They choose Manager or Staff and can remove you any time.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Referral link for new shops</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-lg bg-black/30 px-3 py-1.5 font-mono text-xs text-slate-200">{refLink}</span>
                  <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-xs" onClick={() => copy(refLink, "link")}>
                    {copied === "link" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-400">Shops that sign up with this link are recorded as yours. Signing up doesn't give you access — the owner still decides.</p>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03]">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <Handshake className="h-4 w-4 text-sky-300" />
                <h2 className="font-semibold text-white">Client shops ({withAccess.length})</h2>
              </div>
              {withAccess.length === 0 ? (
                <p className="p-4 text-sm text-slate-400">No shops yet. Share your partner code with a client — once they add you, the shop shows up here.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm" data-testid="partner-shops">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-4 py-2 font-medium">Shop</th>
                        <th className="px-4 py-2 font-medium">Your access</th>
                        <th className="px-4 py-2 text-right font-medium">Orders (30d)</th>
                        <th className="px-4 py-2 text-right font-medium">Sales (30d)</th>
                        <th className="px-4 py-2 font-medium">Last opened</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {withAccess.map((s) => (
                        <tr key={s.tenantId}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-white">{s.name}</p>
                            <p className="text-xs text-slate-500">
                              /{s.slug} · {s.stats?.plan ?? "free"} plan{s.stats?.status === "suspended" ? " · suspended" : ""}
                            </p>
                          </td>
                          <td className="px-4 py-3 capitalize">{s.role}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{s.stats?.orders30d ?? 0}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{peso(s.stats?.sales30d ?? 0)}</td>
                          <td className="px-4 py-3 text-slate-400">{day(s.lastOpenedAt)}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              disabled={opening !== null || p.status !== "active"}
                              onClick={() => void open(s.tenantId)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                              data-testid="partner-open"
                            >
                              {opening === s.tenantId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} Open
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {referralOnly.length > 0 && (
              <section className="rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                  <Store className="h-4 w-4 text-slate-400" />
                  <h2 className="font-semibold text-white">Signed up with your link ({referralOnly.length})</h2>
                </div>
                <ul className="divide-y divide-white/5 text-sm">
                  {referralOnly.map((s) => (
                    <li key={s.tenantId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="text-white">{s.name}</span>
                      <span className="text-xs text-slate-500">since {day(s.linkedAt)} · no access</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        <section aria-label="Sign-in security">
          <TwoFactorCard />
        </section>
      </main>
    </div>
  );
}
