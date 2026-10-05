"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

/**
 * Phase 12: Guma ID sign-in — mobile number, then the 6-digit texted code.
 * Taglish, phone-first, no password. Used on /account and inside checkout.
 */
export function GumaIdSignIn({
  defaultPhone = "",
  onSignedIn,
  compact = false,
  accent = "#0f172a",
}: {
  defaultPhone?: string;
  onSignedIn: (r: { isNew: boolean }) => void | Promise<void>;
  compact?: boolean;
  accent?: string;
}) {
  const [phone, setPhone] = useState(defaultPhone);
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/id/otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone }) });
      const d = (await res.json()) as { ok: boolean; error?: string; phone?: string; devCode?: string };
      if (!d.ok) throw new Error(d.error ?? "Hindi ma-send ang code.");
      if (d.phone) setPhone(d.phone);
      setDevCode(d.devCode ?? null);
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hindi ma-send ang code.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/id/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, code }) });
      const d = (await res.json()) as { ok: boolean; error?: string; isNew?: boolean };
      if (!d.ok) throw new Error(d.error ?? "Mali ang code.");
      await onSignedIn({ isNew: Boolean(d.isNew) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mali ang code.");
      setBusy(false);
    }
  }

  const input = "h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 outline-none focus:border-slate-500";
  return (
    <div className={compact ? "space-y-3" : "space-y-4"} data-testid="guma-id-signin">
      {step === "phone" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-800">Mobile number</span>
            <input className={input} inputMode="tel" autoComplete="tel" placeholder="0917 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Mobile number" />
          </label>
          <button type="submit" disabled={busy || phone.replace(/\D/g, "").length < 10} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-bold text-white disabled:opacity-50" style={{ backgroundColor: accent }}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null} I-text ang code
          </button>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <p className="text-sm text-slate-600">
            Nag-text kami ng 6-digit code sa <strong>{phone}</strong>.{" "}
            <button type="button" className="font-medium underline" onClick={() => { setStep("phone"); setCode(""); }}>
              Palitan
            </button>
          </p>
          {devCode && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Test mode (walang SMS): code ay <strong>{devCode}</strong></p>}
          <input className={`${input} text-center font-mono text-2xl tracking-[0.5em]`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="6-digit code" autoFocus />
          <button type="submit" disabled={busy || code.length !== 6} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-bold text-white disabled:opacity-50" style={{ backgroundColor: accent }}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Mag-sign in
          </button>
          <button type="button" className="w-full text-sm text-slate-500 underline disabled:opacity-50" disabled={busy} onClick={() => void sendCode()}>
            Hindi dumating? I-text ulit
          </button>
        </form>
      )}
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-none" />
        <span>
          Guma ID: isang number para sa lahat ng Guma Kart shops. Ang shop ay makakakita lang ng detalyeng nasa order mo.{" "}
          <a href="/privacy" className="underline">Privacy</a>
        </span>
      </p>
    </div>
  );
}
