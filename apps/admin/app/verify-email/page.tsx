"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  AuthError,
  AuthField,
  AuthLayout,
  AuthSubmitButton,
  authInputClassName,
} from "@/components/auth-layout";

/**
 * Confirm-your-email screen.
 *  - ?token=… : old emailed links still work.
 *  - otherwise: signed-in accounts that never confirmed their email get a
 *    6-digit code (the middleware sends them here until they do).
 */
function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(token ? "Verifying your email…" : null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const sentOnce = useRef(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  function done(redirectTo?: string) {
    setNotice("Email confirmed! Taking you to your shop…");
    setTimeout(() => {
      router.push(redirectTo ?? "/");
      router.refresh();
    }, 900);
  }

  async function sendCode() {
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/auth/verify-email/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const data = await res.json();
      if (res.status === 401) {
        router.push("/login?next=/verify-email");
        return;
      }
      if (!data.ok) {
        setError(data.error ?? "Could not send the code.");
        return;
      }
      if (data.verified) {
        done(data.redirectTo);
        return;
      }
      if (data.devCode) setCode(data.devCode);
      setNotice(
        data.devCode
          ? `Dev mode: email isn't set up, so your code is ${data.devCode}.`
          : `We sent a 6-digit code to ${data.sentTo}. It expires in 10 minutes.`
      );
      setResendIn(60);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }

  // Old link flow.
  useEffect(() => {
    if (!token) return;
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) done(data.redirectTo);
        else {
          setNotice(null);
          setError((data.error ?? "This link is invalid or expired.") + " Use a code instead.");
        }
      })
      .catch(() => setError("Something went wrong."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Code flow: send the first code automatically.
  useEffect(() => {
    if (token || sentOnce.current) return;
    sentOnce.current = true;
    void sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-email/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", code }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "That code didn't work.");
        return;
      }
      done(data.redirectTo);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Confirm your email" subtitle="One quick step to keep your shop secure">
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthError message={error} />
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
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className={`${authInputClassName} text-center text-lg tracking-[0.5em]`}
            placeholder="••••••"
          />
        </AuthField>
        <AuthSubmitButton loading={loading}>Verify email</AuthSubmitButton>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
            }}
            className="hover:text-white"
          >
            Sign out
          </button>
          <button
            type="button"
            disabled={resendIn > 0 || sending}
            onClick={sendCode}
            className="font-medium text-emerald-400 hover:underline disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline"
          >
            {resendIn > 0 ? `Resend code in ${resendIn}s` : "Send a new code"}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
