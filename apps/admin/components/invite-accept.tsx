"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthError, AuthField, AuthLayout, AuthSubmitButton, authInputClassName } from "@/components/auth-layout";
import { PasswordInput } from "@/components/password-input";

interface InviteView {
  email: string;
  name: string | null;
  shopName: string;
  roleLabel: string;
  roleDescription: string;
  hasAccount: boolean;
  status: "valid" | "expired" | "used" | "revoked";
}

const CLOSED: Record<Exclude<InviteView["status"], "valid">, string> = {
  expired: "This invite expired. Ask the shop owner to send a new one.",
  used: "This invite was already used. Sign in with your email and password.",
  revoked: "This invite was cancelled. Ask the shop owner for a new one.",
};

/** Phase 10: a staff member opens the owner's invite link, sets a password, and is in. */
export function InviteAccept({ token }: { token: string }) {
  const [invite, setInvite] = useState<InviteView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/invite?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { ok: boolean; error?: string; invite?: InviteView }) => {
        if (!data.ok || !data.invite) throw new Error(data.error ?? "This invite link isn't valid.");
        setInvite(data.invite);
        setName(data.invite.name ?? "");
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "This invite link isn't valid."));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name, password }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; redirectTo?: string };
      if (!data.ok) throw new Error(data.error ?? "Couldn't join the shop.");
      window.location.assign(data.redirectTo ?? "/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join the shop.");
      setLoading(false);
    }
  }

  if (loadError || (invite && invite.status !== "valid")) {
    return (
      <AuthLayout title="Invite link" subtitle={loadError ?? CLOSED[invite!.status as keyof typeof CLOSED]}>
        <Link href="/login" className="block text-center text-sm font-medium text-emerald-400 hover:underline">
          Go to sign in
        </Link>
      </AuthLayout>
    );
  }

  if (!invite) {
    return (
      <AuthLayout title="Opening your invite…" subtitle="One moment.">
        <div className="h-24 animate-pulse rounded-xl bg-white/5" />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={`Join ${invite.shopName}`} subtitle={`You're invited as ${invite.roleLabel}.`}>
      <p className="mb-5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
        {invite.roleDescription}
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <AuthError message={error} />
        <AuthField label="Email" id="email">
          <input id="email" className={authInputClassName} value={invite.email} readOnly disabled />
        </AuthField>
        <AuthField label="Your name" id="name">
          <input
            id="name"
            className={authInputClassName}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jen Santos"
            autoComplete="name"
            required
            maxLength={80}
          />
        </AuthField>
        <AuthField label={invite.hasAccount ? "Your current password" : "Choose a password"} id="password">
          <PasswordInput
            id="password"
            autoComplete={invite.hasAccount ? "current-password" : "new-password"}
            required
            minLength={invite.hasAccount ? 1 : 8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={invite.hasAccount ? "••••••••" : "At least 8 characters"}
          />
        </AuthField>
        {invite.hasAccount ? (
          <p className="text-xs text-slate-400">This email already has a Guma account — sign in with its password to join.</p>
        ) : null}
        <AuthSubmitButton loading={loading}>Join {invite.shopName}</AuthSubmitButton>
      </form>
    </AuthLayout>
  );
}
