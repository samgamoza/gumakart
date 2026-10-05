"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, MessageSquare, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@gumakart/ui";
import { ROLE_LABELS, STAFF_ROLES, type StaffRole } from "@gumakart/db/staff-permissions";
import { SettingsShell } from "@/components/settings/settings-shell";
import { SettingsCard } from "@/components/settings/settings-forms";

interface Member {
  userId: string;
  name: string;
  email: string;
  role: "owner" | StaffRole;
  hasPin: boolean;
}

interface Invite {
  id: string;
  email: string;
  name: string | null;
  role: StaffRole;
  expiresAt: string;
  expired: boolean;
}

/** What each role can do, in the seller's words. */
const CAN_DO: Array<{ label: string; roles: Array<"owner" | StaffRole> }> = [
  { label: "See orders, pack and ship, book riders", roles: ["owner", "manager", "staff"] },
  { label: "Make checkout links, answer chats, see customers", roles: ["owner", "manager", "staff"] },
  { label: "Sell on POS", roles: ["owner", "manager", "staff", "cashier"] },
  { label: "Confirm or reject GCash/Maya payments", roles: ["owner", "manager"] },
  { label: "Cancel and refund orders", roles: ["owner", "manager"] },
  { label: "Add products, change prices and stock", roles: ["owner", "manager"] },
  { label: "Shop settings, delivery, marketing, POS setup", roles: ["owner", "manager"] },
  { label: "See the activity log", roles: ["owner", "manager"] },
  { label: "Plan, billing, payouts, payment accounts, staff", roles: ["owner"] },
];

export function StaffSettingsPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; email: string; role: StaffRole }>({ name: "", email: "", role: "staff" });
  const [inviting, setInviting] = useState(false);
  const [lastLink, setLastLink] = useState<{ url: string; email: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pinFor, setPinFor] = useState<Member | null>(null);
  const [pin, setPin] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/staff", { cache: "no-store" });
    const data = (await res.json()) as { ok: boolean; error?: string; members?: Member[]; invites?: Invite[]; emailConfigured?: boolean };
    if (!data.ok) {
      setError(data.error ?? "Could not load your team.");
      setMembers([]);
      return;
    }
    setMembers(data.members ?? []);
    setInvites(data.invites ?? []);
    setEmailConfigured(Boolean(data.emailConfigured));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(url: string, init: RequestInit, done: string) {
    setError(null);
    const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!data.ok) {
      setError(data.error ?? "Something went wrong.");
      return false;
    }
    setNotice(done);
    await load();
    return true;
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: form.name || undefined, email: form.email, role: form.role }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; url?: string; emailed?: boolean };
      if (!data.ok || !data.url) throw new Error(data.error ?? "Couldn't create the invite.");
      setLastLink({ url: data.url, email: form.email, emailed: Boolean(data.emailed) });
      setCopied(false);
      setForm({ name: "", email: "", role: form.role });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the invite.");
    } finally {
      setInviting(false);
    }
  }

  async function copyLink() {
    if (!lastLink) return;
    try {
      await navigator.clipboard.writeText(lastLink.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const staffCount = (members ?? []).filter((m) => m.role !== "owner").length;

  return (
    <SettingsShell
      title="Staff & roles"
      description="Give each helper their own login instead of sharing yours. Every payment confirmed, price changed or refund is logged under their name."
    >
      <div className="space-y-5">
        {notice && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-sm text-emerald-100">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {error && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2.5 text-sm text-red-100">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <SettingsCard title={`Your team${members ? ` (${staffCount} staff)` : ""}`}>
          {members === null ? (
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.06]" data-testid="team-list">
              {members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/10 text-sm font-semibold">
                    {m.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">{m.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {m.email}
                      {m.hasPin ? " · has a POS PIN" : ""}
                    </p>
                  </div>
                  {m.role === "owner" ? (
                    <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">Owner</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        className="guma-field h-9 w-auto"
                        value={m.role}
                        aria-label={`Role for ${m.name}`}
                        onChange={(e) =>
                          void call(
                            `/api/staff/${m.userId}`,
                            { method: "PATCH", body: JSON.stringify({ role: e.target.value, name: m.name }) },
                            `${m.name} is now ${ROLE_LABELS[e.target.value as StaffRole].label}. They'll need to sign in again.`
                          )
                        }
                      >
                        {STAFF_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r].label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/[0.05]"
                        onClick={() => {
                          setPinFor(m);
                          setPin("");
                        }}
                      >
                        <KeyRound className="h-3.5 w-3.5" /> {m.hasPin ? "Reset PIN" : "POS PIN"}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-500/10 hover:text-red-300"
                        aria-label={`Remove ${m.name}`}
                        onClick={() => {
                          if (window.confirm(`Remove ${m.name} from the shop? They'll be signed out right away.`)) {
                            void call(`/api/staff/${m.userId}`, { method: "DELETE" }, `${m.name} was removed and signed out.`);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {pinFor && (
            <form
              className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await call(
                  `/api/staff/${pinFor.userId}/pin`,
                  { method: "POST", body: JSON.stringify({ pin, name: pinFor.name }) },
                  `${pinFor.name} can now unlock the POS with their PIN.`
                );
                if (ok) setPinFor(null);
              }}
            >
              <span className="text-sm text-slate-300">POS PIN for {pinFor.name}:</span>
              <input
                className="guma-field h-9 w-28"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                placeholder="4–6 digits"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                aria-label="New PIN"
              />
              <Button type="submit" size="sm" disabled={pin.length < 4}>
                Save PIN
              </Button>
              <button type="button" className="text-sm text-slate-400 hover:text-white" onClick={() => setPinFor(null)}>
                Cancel
              </button>
            </form>
          )}
        </SettingsCard>

        <SettingsCard title="Invite someone">
          <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_1.3fr_auto_auto]">
            <input
              className="guma-field h-10"
              placeholder="Name (e.g. Jen)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={80}
              aria-label="Name"
            />
            <input
              className="guma-field h-10"
              type="email"
              required
              placeholder="Their email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              aria-label="Email"
            />
            <select
              className="guma-field h-10 w-auto"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}
              aria-label="Role"
            >
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r].label}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={inviting || !form.email}>
              <UserPlus className="mr-1.5 h-4 w-4" />
              {inviting ? "Inviting…" : "Invite"}
            </Button>
          </form>
          <p className="text-xs text-slate-400">{ROLE_LABELS[form.role].description}</p>

          {lastLink && (
            <div className="space-y-2 rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] p-3" data-testid="invite-link">
              <p className="text-sm text-emerald-100">
                {lastLink.emailed
                  ? `Invite emailed to ${lastLink.email}. You can also send the link yourself:`
                  : `Send this link to ${lastLink.email} by Messenger, Viber or SMS. It works once and expires in 7 days.`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-black/30 px-3 py-2 text-xs text-slate-200">{lastLink.url}</code>
                <Button type="button" size="sm" variant="secondary" onClick={() => void copyLink()}>
                  {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <a
                  className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/[0.05]"
                  href={`sms:?&body=${encodeURIComponent(`Join our shop on Guma Kart: ${lastLink.url}`)}`}
                >
                  <MessageSquare className="h-4 w-4" /> SMS
                </a>
              </div>
            </div>
          )}
          {!emailConfigured && !lastLink && (
            <p className="text-xs text-slate-500">
              Email sending isn&apos;t switched on yet, so you&apos;ll get a link to send yourself.
            </p>
          )}

          {invites.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Waiting to join</p>
              <ul className="divide-y divide-white/[0.06]">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {i.name ? `${i.name} · ` : ""}
                      {i.email}
                      <span className="ml-2 text-xs text-slate-400">{ROLE_LABELS[i.role].label}</span>
                    </span>
                    <span className={`text-xs ${i.expired ? "text-amber-300" : "text-slate-500"}`}>
                      {i.expired ? "Expired" : `Until ${new Date(i.expiresAt).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-slate-400 hover:text-red-300"
                      onClick={() => void call(`/api/staff/invites/${i.id}`, { method: "DELETE" }, "Invite cancelled.")}
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SettingsCard>

        <SettingsCard title="What each role can do">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-medium" />
                  {(["owner", ...STAFF_ROLES] as const).map((r) => (
                    <th key={r} className="px-2 py-2 text-center font-medium">
                      {ROLE_LABELS[r].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CAN_DO.map((row) => (
                  <tr key={row.label} className="border-t border-white/[0.06]">
                    <td className="py-2 pr-3 text-slate-300">{row.label}</td>
                    {(["owner", ...STAFF_ROLES] as const).map((r) => (
                      <td key={r} className="px-2 py-2 text-center">
                        {row.roles.includes(r) ? <Check className="mx-auto h-4 w-4 text-emerald-300" /> : <span className="text-slate-600">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Changing a role or removing someone signs them out right away. PIN-only cashiers (no login) are still on the POS page.
          </p>
        </SettingsCard>
      </div>
    </SettingsShell>
  );
}
