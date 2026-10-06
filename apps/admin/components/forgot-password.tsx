"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthError, AuthField, AuthLayout, AuthSubmitButton, authInputClassName } from "@/components/auth-layout";
import { PasswordInput } from "@/components/password-input";

/** Phase 19: email → 6-digit code → new password. Works for owners, staff and partners. */
export function ForgotPassword() {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.json();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (step === 1) {
        const d = await post("/api/auth/password/forgot", { email });
        if (!d.ok) return setError(d.error ?? "Could not send the code.");
        if (d.devCode) setCode(d.devCode);
        setNotice(d.devCode ? `Dev mode: your code is ${d.devCode}.` : d.message);
        setStep(2);
      } else {
        const d = await post("/api/auth/password/reset", { email, code, password });
        if (!d.ok) return setError(d.error ?? "Could not reset the password.");
        window.location.href = d.redirectTo ?? "/";
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Reset your password" subtitle={step === 1 ? "We'll email you a 6-digit code" : "Enter the code and a new password"}>
      <form onSubmit={submit} className="space-y-4" data-testid="forgot-password">
        <AuthError message={error} />
        {notice && <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">{notice}</div>}
        {step === 1 ? (
          <AuthField label="Email" id="email">
            <input id="email" type="email" autoComplete="email" required className={authInputClassName} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </AuthField>
        ) : (
          <>
            <AuthField label="6-digit code" id="code">
              <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className={authInputClassName} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            </AuthField>
            <AuthField label="New password" id="password">
              <PasswordInput id="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ characters, letters and numbers" />
            </AuthField>
            <p className="text-xs text-slate-400">Saving signs you out on every other phone and computer.</p>
          </>
        )}
        <AuthSubmitButton loading={loading}>{step === 1 ? "Email me a code" : "Save new password"}</AuthSubmitButton>
        {step === 2 && (
          <button type="button" className="w-full text-center text-sm text-slate-400 underline" onClick={() => { setStep(1); setNotice(null); setCode(""); }}>
            Use a different email / send a new code
          </button>
        )}
      </form>
      <p className="mt-6 text-center text-sm text-slate-400">
        Remembered it? <Link href="/login" className="font-semibold text-white underline">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
