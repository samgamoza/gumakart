"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthError, AuthField, AuthLayout, AuthSubmitButton, authInputClassName } from "@/components/auth-layout";
import { PasswordInput } from "@/components/password-input";

/** Phase 18: agency partner signup — account, email code, agency details. */
export function PartnerJoin() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: "", email: "", password: "" });
  const [agency, setAgency] = useState({ agencyName: "", phone: "", website: "", city: "", about: "" });

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
        const d = await post("/api/auth/signup/start", form);
        if (!d.ok) return setError(d.error ?? "Could not send the code.");
        setCode(d.devCode ?? "");
        setNotice(d.devCode ? `Dev mode: your code is ${d.devCode}.` : `We sent a 6-digit code to ${form.email}.`);
        setStep(2);
      } else if (step === 2) {
        const d = await post("/api/auth/signup/verify", { email: form.email, code });
        if (!d.ok) return setError(d.error ?? "That code didn't work.");
        setTicket(d.ticket);
        setNotice(null);
        setStep(3);
      } else {
        const d = await post("/api/partners/signup", { ...form, ...agency, ticket });
        if (!d.ok) {
          if (d.code === "TICKET_INVALID") setStep(1);
          return setError(d.error ?? "Signup failed.");
        }
        window.location.href = d.redirectTo ?? "/partner";
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Become a Guma Kart partner"
      subtitle={step === 1 ? "For agencies, VAs and consultants who set up and run shops for clients" : step === 2 ? "Confirm your email" : "About your agency"}
    >
      {step === 1 && (
        <ul className="mb-5 space-y-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
          <li>• One dashboard for all your client shops</li>
          <li>• Clients give you access with your partner code — and can remove it any time</li>
          <li>• Your own referral link for new shops</li>
        </ul>
      )}
      <form onSubmit={submit} className="space-y-4" data-testid="partner-join">
        <AuthError message={error} />
        {notice && <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">{notice}</div>}
        {step === 1 && (
          <>
            <AuthField label="Your name" id="displayName">
              <input id="displayName" required className={authInputClassName} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Maria Santos" />
            </AuthField>
            <AuthField label="Work email" id="email">
              <input id="email" type="email" required className={authInputClassName} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@agency.ph" />
            </AuthField>
            <AuthField label="Password" id="password">
              <PasswordInput id="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="8+ characters, letters and numbers" />
            </AuthField>
          </>
        )}
        {step === 2 && (
          <AuthField label="6-digit code" id="code">
            <input id="code" inputMode="numeric" maxLength={6} required autoFocus className={authInputClassName} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </AuthField>
        )}
        {step === 3 && (
          <>
            <AuthField label="Agency or business name" id="agencyName">
              <input id="agencyName" required className={authInputClassName} value={agency.agencyName} onChange={(e) => setAgency({ ...agency, agencyName: e.target.value })} placeholder="Bida Digital" />
            </AuthField>
            <AuthField label="Mobile (optional)" id="phone">
              <input id="phone" className={authInputClassName} value={agency.phone} onChange={(e) => setAgency({ ...agency, phone: e.target.value })} placeholder="09XX XXX XXXX" inputMode="tel" />
            </AuthField>
            <AuthField label="Website or Facebook page (optional)" id="website">
              <input id="website" className={authInputClassName} value={agency.website} onChange={(e) => setAgency({ ...agency, website: e.target.value })} placeholder="facebook.com/bidadigital" />
            </AuthField>
            <AuthField label="City (optional)" id="city">
              <input id="city" className={authInputClassName} value={agency.city} onChange={(e) => setAgency({ ...agency, city: e.target.value })} placeholder="Cebu City" />
            </AuthField>
            <AuthField label="What do you do for shops? (optional)" id="about">
              <textarea id="about" rows={3} maxLength={500} className={`${authInputClassName} h-auto py-2`} value={agency.about} onChange={(e) => setAgency({ ...agency, about: e.target.value })} placeholder="Product photos, listings, FB/TikTok ads, order handling…" />
            </AuthField>
            <p className="text-xs text-slate-400">Guma Kart reviews new partners, usually within 1–2 working days. There's no commission program yet.</p>
          </>
        )}
        <AuthSubmitButton loading={loading}>{step === 1 ? "Continue" : step === 2 ? "Confirm email" : "Create partner account"}</AuthSubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-400">
        Already a partner? <Link href="/login" className="font-semibold text-white underline">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
