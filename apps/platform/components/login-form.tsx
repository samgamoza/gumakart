"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, EyeOff, KeyRound, ShieldCheck, Smartphone } from "lucide-react";

const inputClass =
  "h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const buttonClass =
  "flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60";

type Step = "password" | "verify" | "enroll" | "backup";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json().catch(() => ({ ok: false, error: "Something went wrong." }));
}

/**
 * Ops sign-in (Phase 21): password → authenticator code. An admin without 2FA is walked through
 * setting it up (QR → code → backup codes) before the first session is issued.
 */
export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [enroll, setEnroll] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [lowBackup, setLowBackup] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function restart(message?: string) {
    setStep("password");
    setCode("");
    setEnroll(null);
    setError(message ?? null);
  }

  async function startEnrollment() {
    const json = await post("/api/auth/2fa/enroll", { action: "start" });
    if (!json.ok) return restart(json.error);
    setEnroll({ secret: json.secret, qrSvg: json.qrSvg });
    setStep("enroll");
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const json = await post("/api/auth/login", { email, password });
    if (!json.ok) setError(json.error ?? "Sign in failed.");
    else if (json.step === "enroll") await startEnrollment();
    else setStep("verify");
    setPassword("");
    setLoading(false);
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const json =
      step === "enroll"
        ? await post("/api/auth/2fa/enroll", { action: "confirm", code })
        : await post("/api/auth/2fa/verify", { code });
    setLoading(false);
    if (!json.ok) {
      if (/expired/i.test(json.error ?? "")) return restart(json.error);
      setError(json.error ?? "That code didn't work.");
      return;
    }
    if (Array.isArray(json.backupCodes)) {
      setBackupCodes(json.backupCodes);
      setStep("backup");
      return;
    }
    if (typeof json.backupCodesLeft === "number" && json.backupCodesLeft <= 3) {
      setLowBackup(json.backupCodesLeft);
      return;
    }
    router.push(json.redirectTo ?? "/");
    router.refresh();
  }

  function finish() {
    router.push("/");
    router.refresh();
  }

  const errorBox = error && (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error}
    </div>
  );

  if (lowBackup !== null) {
    return (
      <div className="space-y-4" data-testid="ops-low-backup">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
          You signed in with a backup code. <strong>{lowBackup}</strong> left. Make new ones in Settings → Your sign-in.
        </div>
        <button type="button" onClick={finish} className={buttonClass}>
          Continue to console
        </button>
      </div>
    );
  }

  if (step === "backup") {
    return (
      <div className="space-y-4" data-testid="ops-backup-codes">
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Two-step sign-in is on. Save these backup codes somewhere safe — each works once if you lose your phone. They won&apos;t be shown again.</span>
        </div>
        <ol className="grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 font-mono text-sm text-gray-900">
          {backupCodes.map((c) => (
            <li key={c} className="text-center">{c}</li>
          ))}
        </ol>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard?.writeText(backupCodes.join("\n")).catch(() => null);
            setCopied(true);
          }}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy codes"}
        </button>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          I saved my backup codes
        </label>
        <button type="button" disabled={!saved} onClick={finish} className={buttonClass}>
          Continue to console
        </button>
      </div>
    );
  }

  if (step === "verify" || step === "enroll") {
    return (
      <form onSubmit={submitCode} className="space-y-4">
        {errorBox}
        {step === "enroll" && enroll ? (
          <div className="space-y-3" data-testid="ops-enroll">
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
              <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Ops accounts need two-step sign-in. Scan this with Google Authenticator, Microsoft Authenticator, 1Password or
                any authenticator app, then enter the 6-digit code it shows.
              </span>
            </div>
            <div
              className="mx-auto w-48 rounded-xl border border-gray-200 bg-white p-2 [&_svg]:h-auto [&_svg]:w-full"
              aria-label="QR code for your authenticator app"
              role="img"
              dangerouslySetInnerHTML={{ __html: enroll.qrSvg }}
            />
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer">Can&apos;t scan? Enter this key instead</summary>
              <code className="mt-2 block break-all rounded-lg bg-gray-50 p-2 font-mono text-gray-800">
                {enroll.secret.replace(/(.{4})/g, "$1 ").trim()}
              </code>
            </details>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Enter the 6-digit code from your authenticator app. Lost your phone? Use one of your backup codes.</span>
          </div>
        )}
        <div>
          <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-gray-700">
            {step === "enroll" ? "Code from your app" : "Code"}
          </label>
          <input
            id="code"
            autoFocus
            required
            inputMode={step === "enroll" ? "numeric" : "text"}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${inputClass} text-center font-mono text-lg tracking-widest`}
            placeholder="123 456"
            maxLength={step === "enroll" ? 7 : 12}
          />
        </div>
        <button type="submit" disabled={loading || code.trim().length < 6} className={buttonClass}>
          {loading ? "Checking..." : step === "enroll" ? "Turn on and sign in" : "Verify"}
        </button>
        <button type="button" onClick={() => restart()} className="w-full text-center text-xs text-gray-500 hover:text-gray-700">
          Start over
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword} className="space-y-4">
      {errorBox}

      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="admin@guma.ph"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-700">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-400 hover:text-gray-600"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <button type="submit" disabled={loading} className={buttonClass}>
        {loading ? "Signing in..." : "Continue"}
      </button>
    </form>
  );
}
