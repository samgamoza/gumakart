"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { Button } from "@gumakart/ui";
import { inputClassName } from "@/components/settings/settings-forms";

type Status = { enabled: boolean; enabledAt: string | null; backupCodesLeft: number };
type Mode = "idle" | "setup" | "codes" | "disable" | "regenerate";

async function call(body: unknown) {
  const res = await fetch("/api/account/two-factor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false, error: "Something went wrong." }));
}

/**
 * Phase 21: optional two-step sign-in for sellers, staff and partners (Settings → Account and the
 * partner dashboard). On = a code from an authenticator app after the password, Google sign-in
 * or a password reset.
 */
export function TwoFactorCard({ className = "" }: { className?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    const res = await fetch("/api/account/two-factor");
    const json = await res.json().catch(() => null);
    if (json?.ok) setStatus({ enabled: json.enabled, enabledAt: json.enabledAt, backupCodesLeft: json.backupCodesLeft });
  }

  useEffect(() => {
    void load();
  }, []);

  function reset(next: Mode = "idle") {
    setMode(next);
    setCode("");
    setError(null);
  }

  async function start() {
    setBusy(true);
    setError(null);
    const json = await call({ action: "start" });
    setBusy(false);
    if (!json.ok) return setError(json.error);
    setSetup({ secret: json.secret, qrSvg: json.qrSvg });
    reset("setup");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const action = mode === "setup" ? "confirm" : mode;
    const json = await call({ action, code });
    setBusy(false);
    if (!json.ok) return setError(json.error);
    if (Array.isArray(json.backupCodes)) {
      setCodes(json.backupCodes);
      setCopied(false);
      reset("codes");
    } else {
      reset();
    }
    void load();
  }

  const on = status?.enabled;

  return (
    <div className={`rounded-xl border border-border bg-card p-5 ${className}`} data-testid="two-factor-card">
      <div className="flex items-start gap-3">
        {on ? <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600" /> : <ShieldOff className="mt-0.5 h-5 w-5 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-foreground">Two-step sign-in</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {status === null
              ? "Checking…"
              : on
                ? `On${status.enabledAt ? ` since ${new Date(status.enabledAt).toLocaleDateString("en-PH", { dateStyle: "medium" })}` : ""}. After your password (or Google), you'll enter a code from your authenticator app. Backup codes left: ${status.backupCodesLeft}.`
                : "Off. Turn it on so a stolen password alone can't open your shop. You'll need an authenticator app such as Google Authenticator or Microsoft Authenticator."}
          </p>

          {mode === "codes" && (
            <div className="mt-4 space-y-3" data-testid="two-factor-backup-codes">
              <p className="text-sm font-medium text-foreground">
                Save these backup codes. Each one works once if you lose your phone, and they won&apos;t be shown again.
              </p>
              <ol className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-3 font-mono text-sm sm:grid-cols-5">
                {codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(codes.join("\n")).catch(() => null);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button type="button" onClick={() => reset()}>
                  I saved them
                </Button>
              </div>
            </div>
          )}

          {mode === "setup" && setup && (
            <form onSubmit={submit} className="mt-4 space-y-3">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Scan this with your authenticator app, then type the 6-digit code it shows.</span>
              </div>
              <div
                className="w-44 rounded-lg border border-border bg-white p-2 [&_svg]:h-auto [&_svg]:w-full"
                role="img"
                aria-label="QR code for your authenticator app"
                dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
              />
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Can&apos;t scan? Enter this key instead</summary>
                <code className="mt-1 block break-all font-mono text-foreground">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
              </details>
              <CodeRow code={code} setCode={setCode} busy={busy} label="Turn on" onCancel={() => reset()} />
            </form>
          )}

          {(mode === "disable" || mode === "regenerate") && (
            <form onSubmit={submit} className="mt-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                {mode === "disable" ? "Enter a code from your app (or a backup code) to turn two-step sign-in off." : "Enter a code from your app to make new backup codes. The old ones will stop working."}
              </p>
              <CodeRow code={code} setCode={setCode} busy={busy} label={mode === "disable" ? "Turn off" : "Make new codes"} onCancel={() => reset()} />
            </form>
          )}

          {error && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {error}
            </p>
          )}

          {mode === "idle" && status && (
            <div className="mt-4 flex flex-wrap gap-2">
              {on ? (
                <>
                  <Button type="button" variant="secondary" onClick={() => reset("regenerate")}>
                    New backup codes
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => reset("disable")}>
                    Turn off
                  </Button>
                </>
              ) : (
                <Button type="button" onClick={start} disabled={busy} data-testid="two-factor-start">
                  {busy ? "Starting…" : "Turn on two-step sign-in"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CodeRow({ code, setCode, busy, label, onCancel }: { code: string; setCode: (v: string) => void; busy: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoFocus
        autoComplete="one-time-code"
        placeholder="123 456"
        aria-label="Code"
        className={`${inputClassName()} w-40 text-center font-mono tracking-widest`}
      />
      <Button type="submit" disabled={busy || code.trim().length < 6}>
        {busy ? "Checking…" : label}
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
