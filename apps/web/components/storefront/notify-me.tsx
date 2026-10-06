"use client";

import { useState } from "react";
import { Bell, Check } from "lucide-react";

/**
 * Phase 22: "Notify me" on a sold-out item. One text (or email) when it's back — nothing else.
 */
export function NotifyMe({
  tenantSlug,
  productId,
  variantId,
  accent,
  accentText,
}: {
  tenantSlug: string;
  productId: string;
  variantId: string | null;
  accent: string;
  accentText: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"phone" | "email">("phone");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stock-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantSlug, productId, variantId, [mode]: value.trim() }),
      });
      const d = await res.json();
      if (!d.ok) setError(d.error ?? "Could not save that.");
      else setDone(true);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 px-4 py-4 text-sm font-medium text-emerald-800" data-testid="notify-done">
        <Check className="h-4 w-4" /> We&apos;ll {mode === "phone" ? "text" : "email"} you once when it&apos;s back.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <p className="text-center text-sm font-medium text-red-600">Sold out</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full py-4 text-base font-semibold shadow-sm transition hover:opacity-90"
          style={{ backgroundColor: accent, color: accentText }}
          data-testid="notify-me"
        >
          <Bell className="h-5 w-5" /> Notify me when it&apos;s back
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-neutral-200 p-4" data-testid="notify-form">
      <div className="flex gap-2 text-xs">
        {(["phone", "email"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setValue("");
            }}
            aria-pressed={mode === m}
            className={`rounded-full px-3 py-1 font-medium ${mode === m ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"}`}
          >
            {m === "phone" ? "Text me" : "Email me"}
          </button>
        ))}
      </div>
      <input
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        type={mode === "phone" ? "tel" : "email"}
        inputMode={mode === "phone" ? "tel" : "email"}
        autoComplete={mode === "phone" ? "tel" : "email"}
        placeholder={mode === "phone" ? "0917 123 4567" : "you@email.com"}
        className="h-11 w-full rounded-xl border border-neutral-300 px-3 text-sm"
      />
      <p className="text-xs text-neutral-500">One message when it&apos;s back in stock. We won&apos;t use it for anything else.</p>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-full py-3 text-sm font-semibold disabled:opacity-60"
        style={{ backgroundColor: accent, color: accentText }}
      >
        {busy ? "Saving…" : "Notify me"}
      </button>
    </form>
  );
}
