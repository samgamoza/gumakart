"use client";

import { useState, useTransition } from "react";
import { addIncidentUpdateAction, createIncidentAction } from "@/app/actions";

const COMPONENTS: Array<[string, string]> = [
  ["checkout", "Checkout & online stores"],
  ["dashboard", "Seller dashboard"],
  ["pos", "POS"],
  ["notifications", "SMS & email updates"],
  ["payments", "Online payments"],
  ["channels", "Messenger, Instagram, Shopee & Lazada"],
  ["api", "API & webhooks"],
];

const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

export function NewIncidentForm() {
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [impact, setImpact] = useState<"minor" | "major" | "maintenance">("minor");
  const [components, setComponents] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await createIncidentAction({ title, impact, components, message });
          if (res.ok) {
            setTitle("");
            setMessage("");
            setComponents([]);
          } else setError(res.error);
        });
      }}
    >
      <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. SMS updates are delayed" maxLength={160} data-testid="incident-title" />
      <div className="flex flex-wrap gap-2 text-sm">
        {(["minor", "major", "maintenance"] as const).map((i) => (
          <label key={i} className={`cursor-pointer rounded-full border px-3 py-1 ${impact === i ? "border-foreground bg-foreground text-background" : "border-border"}`}>
            <input type="radio" className="sr-only" checked={impact === i} onChange={() => setImpact(i)} />
            {i === "minor" ? "Minor (some slow/failing)" : i === "major" ? "Major (down)" : "Planned maintenance"}
          </label>
        ))}
      </div>
      <div className="grid gap-1 sm:grid-cols-2 text-sm">
        {COMPONENTS.map(([id, label]) => (
          <label key={id} className="flex items-center gap-2">
            <input type="checkbox" checked={components.includes(id)} onChange={() => setComponents((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))} />
            {label}
          </label>
        ))}
      </div>
      <textarea className={field} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What sellers see, in plain words. e.g. Some order texts are going out late. Orders and payments are not affected." maxLength={1000} data-testid="incident-message" />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button type="submit" disabled={pending} className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50" data-testid="incident-submit">
        {pending ? "Posting…" : "Post incident"}
      </button>
    </form>
  );
}

export function IncidentUpdateForm({ id, current }: { id: string; current: string }) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<"investigating" | "identified" | "monitoring" | "resolved">(current === "investigating" ? "identified" : current === "identified" ? "monitoring" : "resolved");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-3 flex flex-wrap items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await addIncidentUpdateAction(id, { status, message });
          if (res.ok) setMessage("");
          else setError(res.error);
        });
      }}
    >
      <select className="rounded-lg border border-border bg-background px-2 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
        <option value="investigating">Investigating</option>
        <option value="identified">Identified</option>
        <option value="monitoring">Monitoring</option>
        <option value="resolved">Resolved</option>
      </select>
      <input className={`${field} min-w-0 flex-1`} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Update for sellers" maxLength={1000} />
      <button type="submit" disabled={pending || !message.trim()} className="rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-50">
        Post update
      </button>
      {error && <p className="w-full text-sm text-rose-600">{error}</p>}
    </form>
  );
}
