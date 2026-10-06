"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AuthError,
  AuthField,
  AuthLayout,
  AuthSubmitButton,
  authInputClassName,
} from "@/components/auth-layout";
import { PasswordInput } from "@/components/password-input";
import { AuthDivider, GoogleSignInButton } from "@/components/google-sign-in-button";
import { BusinessFields, EMPTY_BUSINESS, validateBusiness, type BusinessForm } from "@/components/business-step";
import { capturePartnerRef, clearPartnerRef } from "@/lib/partner-ref";

export function SignupWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [business, setBusiness] = useState<BusinessForm>(EMPTY_BUSINESS);
  // Email confirmation (step 2)
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  // Phase 18: signed up through an agency partner's link (?partner=P-XXXXXX).
  const [partnerRef, setPartnerRef] = useState<{ code: string; name: string } | null>(null);
  useEffect(() => {
    const code = capturePartnerRef();
    if (!code) return;
    fetch(`/api/partners/code?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((d) => (d.ok ? setPartnerRef({ code: d.partner.code, name: d.partner.name }) : clearPartnerRef()))
      .catch(() => null);
  }, []);

  const [form, setForm] = useState({
    displayName: "",
    email: "",
    password: "",
  });

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  function updateField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    // A different email needs a fresh code.
    if (key === "email") setTicket(null);
  }

  async function sendCode(): Promise<boolean> {
    const res = await fetch("/api/auth/signup/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.email, password: form.password, displayName: form.displayName }),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error ?? "Could not send the code.");
      return false;
    }
    setCode(data.devCode ?? "");
    setNotice(
      data.devCode
        ? `Dev mode: email isn't set up, so your code is ${data.devCode}.`
        : `We sent a 6-digit code to ${form.email}. It expires in 10 minutes.`
    );
    setResendIn(60);
    return true;
  }

  async function handleResend() {
    setError(null);
    setLoading(true);
    try {
      await sendCode();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (step === 1) {
      if (ticket) {
        setStep(3);
        return;
      }
      setLoading(true);
      try {
        if (await sendCode()) setStep(2);
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (step === 2) {
      setLoading(true);
      try {
        const res = await fetch("/api/auth/signup/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email, code }),
        });
        const data = await res.json();
        if (!data.ok) {
          setError(data.error ?? "That code didn't work.");
          return;
        }
        setTicket(data.ticket);
        setNotice(null);
        setStep(3);
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setLoading(false);
      }
      return;
    }

    const problem = validateBusiness(business);
    if (problem) {
      setError(problem);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...business, chatUrl: business.chatUrl || undefined, ticket, partnerCode: partnerRef?.code }),
      });
      const data = await res.json();

      if (!data.ok) {
        if (data.code === "TICKET_INVALID") {
          setTicket(null);
          setStep(1);
        }
        setError(data.error ?? "Signup failed.");
        return;
      }

      clearPartnerRef();
      router.push(data.redirectTo ?? "/onboarding");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title={step === 3 ? "Your business" : "Start your shop free"}
      subtitle={
        step === 1
          ? "Create your account with Google or email"
          : step === 2
            ? "Confirm your email"
            : "Step 1 of 4 — Your business"
      }
    >
      {partnerRef && (
        <p className="mb-4 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100" data-testid="partner-ref">
          Invited by <strong>{partnerRef.name}</strong>, a Guma Kart partner. You can give them access to help with your shop later, in Settings → Partner.
        </p>
      )}
      {step === 1 && (
        <>
          <GoogleSignInButton intent="signup" label="Sign up with Google" />
          <AuthDivider />
        </>
      )}

      {step === 3 && (
        // Same 4-step bar as /onboarding: this is step 1 of 4.
        <div className="mb-6 flex gap-2" aria-hidden>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className={`h-1.5 flex-1 rounded-full ${n === 1 ? "bg-emerald-500" : "bg-white/10"}`} />
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthError message={error} />

        {step === 1 ? (
          <>
            <AuthField label="Your name" id="displayName">
              <input
                id="displayName"
                required
                value={form.displayName}
                onChange={(e) => updateField("displayName", e.target.value)}
                className={authInputClassName}
                placeholder="Maria Santos"
              />
            </AuthField>

            <AuthField label="Email" id="email">
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                className={authInputClassName}
                placeholder="you@example.com"
              />
            </AuthField>

            <AuthField label="Password" id="password">
              <PasswordInput
                id="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => updateField("password", e.target.value)}
                placeholder="8+ characters, letters and numbers"
              />
            </AuthField>
          </>
        ) : step === 2 ? (
          <>
            {notice && (
              <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
                {notice}
              </div>
            )}
            <AuthField label="6-digit code" id="code">
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className={`${authInputClassName} text-center text-lg tracking-[0.5em]`}
                placeholder="••••••"
              />
            </AuthField>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setCode("");
                  setNotice(null);
                }}
                className="hover:text-white"
              >
                Wrong email? Change it
              </button>
              <button
                type="button"
                disabled={resendIn > 0 || loading}
                onClick={handleResend}
                className="font-medium text-emerald-400 hover:underline disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline"
              >
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </button>
            </div>
          </>
        ) : (
          <>
            <BusinessFields value={business} onChange={setBusiness} />
          </>
        )}

        <div className="flex gap-2 pt-2">
          {step === 3 && (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="h-11 flex-1 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted"
            >
              Back
            </button>
          )}
          <div className={step === 3 ? "flex-1" : "w-full"}>
            <AuthSubmitButton loading={loading}>
              {step === 1 ? (ticket ? "Continue" : "Send code") : step === 2 ? "Verify email" : "Continue"}
            </AuthSubmitButton>
          </div>
        </div>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-emerald-700 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
