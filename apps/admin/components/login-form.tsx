"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Phase 21: second step for accounts with two-step sign-in (also reached from Google sign-in,
  // a password reset or a staff invite via ?step=2fa).
  const [codeStep, setCodeStep] = useState(false);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const oauthError = searchParams.get("error");
    if (oauthError) {
      setError(decodeURIComponent(oauthError.replace(/\+/g, " ")));
    }
    if (searchParams.get("step") === "2fa") {
      setCodeStep(true);
      if (searchParams.get("reset") === "1") setNotice("Your password was changed. Enter your sign-in code to finish.");
    }
  }, [searchParams]);

  function goNext(redirectTo?: string) {
    const next = searchParams.get("next");
    router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : redirectTo ?? "/");
    router.refresh();
  }

  async function handleCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!data.ok) {
        if (data.code === "TICKET_EXPIRED") {
          setCodeStep(false);
          setCode("");
        }
        setError(data.error ?? "That code didn't work.");
        return;
      }
      if (typeof data.backupCodesLeft === "number" && data.backupCodesLeft <= 3) {
        window.alert(`You used a backup code. ${data.backupCodesLeft} left — make new ones in Settings → Account.`);
      }
      goNext(data.redirectTo);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!data.ok) {
        setError(data.error ?? "Login failed.");
        return;
      }
      if (data.twoFactor) {
        setPassword("");
        setCodeStep(true);
        return;
      }

      goNext(data.redirectTo);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (codeStep) {
    return (
      <AuthLayout title="Two-step sign-in" subtitle="Enter the 6-digit code from your authenticator app.">
        <form onSubmit={handleCode} className="space-y-4" data-testid="two-factor-step">
          {notice && <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">{notice}</p>}
          <AuthError message={error} />
          <AuthField label="Code" id="code">
            <input
              id="code"
              autoFocus
              required
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${authInputClassName} text-center font-mono text-lg tracking-widest`}
              placeholder="123 456"
              maxLength={12}
            />
          </AuthField>
          <p className="-mt-2 text-xs text-slate-400">Lost your phone? Type one of your backup codes instead.</p>
          <AuthSubmitButton loading={loading}>Verify</AuthSubmitButton>
          <button
            type="button"
            onClick={() => {
              setCodeStep(false);
              setCode("");
              setError(null);
              setNotice(null);
              router.replace("/login");
            }}
            className="block w-full text-center text-xs text-slate-400 underline hover:text-white"
          >
            Use a different account
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in with Google or your email and password."
    >
      <GoogleSignInButton intent="login" />
      <AuthDivider />

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthError message={error} />

        <AuthField label="Email" id="email">
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClassName}
            placeholder="you@example.com"
          />
        </AuthField>

        <AuthField label="Password" id="password">
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </AuthField>
        <div className="-mt-2 text-right">
          <Link href="/forgot-password" className="text-xs text-slate-400 underline hover:text-white" data-testid="forgot-link">
            Forgot password?
          </Link>
        </div>

        <AuthSubmitButton loading={loading}>Sign in</AuthSubmitButton>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to Guma One?{" "}
        <Link href="/signup" className="font-medium text-emerald-700 hover:underline">
          Start free
        </Link>
      </p>
    </AuthLayout>
  );
}
