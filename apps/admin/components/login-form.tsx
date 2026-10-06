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

  useEffect(() => {
    const oauthError = searchParams.get("error");
    if (oauthError) {
      setError(decodeURIComponent(oauthError.replace(/\+/g, " ")));
    }
  }, [searchParams]);

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

      const next = searchParams.get("next");
      router.push(next && next.startsWith("/") ? next : data.redirectTo ?? "/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
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
