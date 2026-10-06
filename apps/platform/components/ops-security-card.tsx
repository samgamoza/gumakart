"use client";

import { useState } from "react";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { regenerateOpsBackupCodesAction, signOutEverywhereAction } from "@/app/settings/security-actions";

/** Phase 21: the ops admin's own two-step sign-in (always on) — backup codes and sign-out-everywhere. */
export function OpsSecurityCard({ enabledAt, backupCodesLeft }: { enabledAt: string | null; backupCodesLeft: number }) {
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [left, setLeft] = useState(backupCodesLeft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function regenerate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await regenerateOpsBackupCodesAction(code);
    setBusy(false);
    setCode("");
    if (!r.ok) return setError(r.error);
    setCodes(r.backupCodes);
    setLeft(r.backupCodes.length);
  }

  async function signOutAll() {
    if (!window.confirm("Sign out of the ops console on every device, including this one?")) return;
    await signOutEverywhereAction();
    window.location.href = "/login";
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" data-testid="ops-security">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-gray-900">Your sign-in</h2>
          <p className="mt-1 text-sm text-gray-600">
            Two-step sign-in is <strong className="text-emerald-700">on</strong>
            {enabledAt ? ` since ${new Date(enabledAt).toLocaleDateString("en-PH", { dateStyle: "medium" })}` : ""}. It&apos;s
            required for every ops account. Backup codes left: <strong className={left <= 3 ? "text-amber-700" : ""}>{left}</strong>
          </p>

          {codes ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-gray-900">New backup codes — save them now; the old ones no longer work.</p>
              <ol className="grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 font-mono text-sm sm:grid-cols-5">
                {codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
            </div>
          ) : (
            <form onSubmit={regenerate} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm">
                <span className="mb-1 block font-medium text-gray-700">Make new backup codes</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Current code from your app"
                  autoComplete="one-time-code"
                  className="h-10 w-full rounded-xl border border-gray-200 px-3 font-mono text-sm outline-none focus:border-emerald-400"
                />
              </label>
              <button disabled={busy || code.trim().length < 6} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
                <KeyRound className="h-4 w-4" />
                {busy ? "Checking…" : "New codes"}
              </button>
            </form>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}

          <button onClick={signOutAll} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-red-600">
            <LogOut className="h-4 w-4" /> Sign out everywhere
          </button>
          <p className="mt-3 text-xs text-gray-500">
            Lost your phone and your backup codes? Another ops admin resets it in the database — see docs/PHASE-21-NOTES.md.
          </p>
        </div>
      </div>
    </section>
  );
}
