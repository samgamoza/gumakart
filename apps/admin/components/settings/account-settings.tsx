"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@gumakart/ui";
import { SettingsPageLayout } from "@/components/settings/settings-shell";
import {
  SettingsCard,
  SettingsField,
  inputClassName,
} from "@/components/settings/settings-forms";
import { TwoFactorCard } from "@/components/settings/two-factor-card";

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res
    .json()
    .catch(() => ({ ok: false, error: "Something went wrong." }));
}

export function AccountSettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [signOutMsg, setSignOutMsg] = useState<string | null>(null);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword)
      return setMessage({ ok: false, text: "The new passwords don't match." });
    setSaving(true);
    const json = await post("/api/account/password", {
      currentPassword,
      newPassword,
    });
    setSaving(false);
    if (!json.ok)
      return setMessage({
        ok: false,
        text: json.error ?? "Couldn't change the password.",
      });
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setMessage({
      ok: true,
      text: "Password changed. Other devices were signed out.",
    });
  }

  async function signOutOthers() {
    setSignOutMsg(null);
    const json = await post("/api/account/sign-out-others");
    setSignOutMsg(
      json.ok
        ? "Done — every other device is signed out."
        : (json.error ?? "Something went wrong."),
    );
  }

  return (
    <SettingsPageLayout
      title="Password & security"
      description="Your password, two-step sign-in and signed-in devices."
    >
      <div className="space-y-4">
        <TwoFactorCard />

        <SettingsCard title="Change password">
          <form
            onSubmit={changePassword}
            className="space-y-4"
            data-testid="change-password"
          >
            <SettingsField label="Current password">
              <input
                type="password"
                autoComplete="current-password"
                required
                className={inputClassName()}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </SettingsField>
            <SettingsField
              label="New password"
              hint="At least 8 characters, with letters and numbers."
            >
              <input
                type="password"
                autoComplete="new-password"
                required
                className={inputClassName()}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </SettingsField>
            <SettingsField label="Confirm new password">
              <input
                type="password"
                autoComplete="new-password"
                required
                className={inputClassName()}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </SettingsField>
            <p className="text-xs text-muted-foreground">
              Signed in with Google and never set a password? Use{" "}
              <Link href="/forgot-password" className="underline">
                Forgot password
              </Link>{" "}
              to add one.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Change password"}
              </Button>
              {message && (
                <p
                  role={message.ok ? "status" : "alert"}
                  className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}
                >
                  {message.text}
                </p>
              )}
            </div>
          </form>
        </SettingsCard>

        <SettingsCard title="Signed-in devices">
          <p className="text-sm text-muted-foreground">
            Lost a phone or used a shared computer? Sign out everywhere except
            this device.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={signOutOthers}>
              Sign out other devices
            </Button>
            {signOutMsg && (
              <p className="text-sm text-muted-foreground">{signOutMsg}</p>
            )}
          </div>
        </SettingsCard>
      </div>
    </SettingsPageLayout>
  );
}
