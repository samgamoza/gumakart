"use client";

import * as React from "react";

/* Tiny primitives for the Kart revamp. Styled by app/kart/kart.css (.k-*). */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  // Tie the label, hint and error to the control so taps on the label focus it and
  // screen readers announce the name and the problem.
  const uid = React.useId();
  const noteId = error || hint ? `${uid}-note` : undefined;
  const control = React.isValidElement<Record<string, unknown>>(children)
    ? React.cloneElement(children, {
        id: (children.props.id as string | undefined) ?? uid,
        "aria-describedby": noteId,
        "aria-invalid": error ? true : children.props["aria-invalid"],
      })
    : children;
  const controlId = React.isValidElement<Record<string, unknown>>(children)
    ? ((children.props.id as string | undefined) ?? uid)
    : undefined;
  return (
    <div>
      <label className="k-label" htmlFor={controlId}>{label}</label>
      {control}
      {error ? (
        <p id={noteId} role="alert" className="mt-1 text-xs font-medium text-[color:var(--kart-danger)]">{error}</p>
      ) : hint ? (
        <p id={noteId} className="mt-1 text-xs text-[color:var(--kart-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-on={on}
      onClick={() => onChange(!on)}
      className="k-switch"
    />
  );
}

export function SectionTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-base font-extrabold tracking-tight">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--kart-ink)] text-xs font-bold text-white">
        {n}
      </span>
      {children}
    </h2>
  );
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "orange" | "green" }) {
  const cls =
    tone === "orange"
      ? "bg-[color:var(--kart-orange-soft)] text-[color:var(--kart-orange-dark)]"
      : tone === "green"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{children}</span>;
}

/** Bandwidth-friendly product thumbnail: no image download, just an SVG. */
export function ProductThumb({ size = 64 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-200 to-orange-300 text-orange-900"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
      </svg>
    </div>
  );
}
