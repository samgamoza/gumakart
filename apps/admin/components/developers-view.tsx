"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, RotateCw, Send, Trash2, Webhook } from "lucide-react";
import { Button, Card } from "@gumakart/ui";
import {
  API_SCOPES,
  API_SCOPE_LABELS,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_MAX_ATTEMPTS,
  type ApiScope,
  type WebhookEventName,
} from "@gumakart/db/developer";

/**
 * Phase 15 — API & webhooks (owner only). API keys for the shop's own tools, signed webhooks
 * with delivery history, and the API reference.
 */

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdByName: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

interface EndpointRow {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEventName[];
  active: boolean;
  consecutiveFailures: number;
  disabledReason: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  stats: { succeeded24h: number; failed24h: number; pending: number };
}

interface DeliveryRow {
  id: string;
  event: string;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  responseMs: number | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
}

type Tab = "keys" | "webhooks" | "docs";

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs hover:bg-white/5"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : label}
    </button>
  );
}

function Secret({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3" data-testid="secret-box">
      <p className="text-sm font-semibold text-amber-200">{title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-black/30 px-2 py-1.5 font-mono text-xs">{value}</code>
        <CopyButton text={value} />
      </div>
      <p className="mt-2 text-xs text-amber-100/80">{note}</p>
    </div>
  );
}

function Confirm({ label, confirmLabel, onConfirm, danger = true }: { label: React.ReactNode; confirmLabel: string; onConfirm: () => void; danger?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs ${armed ? (danger ? "bg-red-500/20 text-red-200" : "bg-white/10") : "text-muted-foreground hover:text-foreground"}`}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

// ─── API keys ────────────────────────────────────────────────────────────────

function KeysTab() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["orders:read"]);
  const [expires, setExpires] = useState<"" | "30" | "90" | "365">("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);

  const load = useCallback(async () => {
    const d = (await (await fetch("/api/developers/keys", { cache: "no-store" })).json()) as { ok: boolean; keys: KeyRow[]; error?: string };
    if (d.ok) setKeys(d.keys);
    else setMsg(d.error ?? "Could not load keys.");
  }, []);
  useEffect(() => void load(), [load]);

  const toggle = (s: ApiScope) => setScopes((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));

  async function create() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/developers/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, scopes, expiresInDays: expires ? Number(expires) : null }),
    });
    const d = (await res.json()) as { ok: boolean; token?: string; key?: KeyRow; error?: string };
    setBusy(false);
    if (!d.ok || !d.token) return setMsg(d.error ?? "Could not create the key.");
    setCreated({ name: d.key?.name ?? name, token: d.token });
    setName("");
    await load();
  }

  async function revoke(id: string) {
    const d = (await (await fetch(`/api/developers/keys/${id}`, { method: "DELETE" })).json()) as { ok: boolean; error?: string };
    if (!d.ok) setMsg(d.error ?? "Could not revoke.");
    await load();
  }

  const now = Date.now();
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <KeyRound className="h-4 w-4" /> New API key
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Give each tool its own key with only the permissions it needs. Keys reach your shop data — treat them like a password.
        </p>
        <div className="mt-4 space-y-4">
          <label className="block text-sm">
            Name
            <input className="guma-field mt-1 h-10 w-full max-w-md" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Accounting sync" maxLength={80} data-testid="key-name" />
          </label>
          <fieldset>
            <legend className="text-sm">Permissions</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {API_SCOPES.map((s) => (
                <label key={s} className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${scopes.includes(s) ? "border-violet-400/60 bg-violet-500/10" : "border-white/10"}`}>
                  <input type="checkbox" className="mt-0.5" checked={scopes.includes(s)} onChange={() => toggle(s)} />
                  <span>
                    <span className="font-medium">{API_SCOPE_LABELS[s].label}</span> <code className="text-[11px] text-muted-foreground">{s}</code>
                    <span className="block text-xs text-muted-foreground">{API_SCOPE_LABELS[s].description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Expires
              <select className="guma-field mt-1 block h-10 w-40" value={expires} onChange={(e) => setExpires(e.target.value as typeof expires)}>
                <option value="">Never</option>
                <option value="30">In 30 days</option>
                <option value="90">In 90 days</option>
                <option value="365">In 1 year</option>
              </select>
            </label>
            <Button type="button" onClick={create} disabled={busy || !name.trim() || scopes.length === 0} data-testid="create-key">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create key
            </Button>
          </div>
          {msg && <p className="text-sm text-red-300">{msg}</p>}
          {created && (
            <Secret title={`Your key for "${created.name}"`} value={created.token} note="Copy it now and keep it somewhere safe. You won't see it again — if it's lost, revoke it and make a new one." />
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Keys</h2>
        {!keys ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : keys.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No keys yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/10" data-testid="key-list">
            {keys.map((k) => {
              const expired = Boolean(k.expiresAt && Date.parse(k.expiresAt) <= now);
              const state = k.revokedAt ? "Revoked" : expired ? "Expired" : "Active";
              return (
                <li key={k.id} className={`flex flex-wrap items-start gap-3 py-3 ${state !== "Active" ? "opacity-60" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {k.name}{" "}
                      <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${state === "Active" ? "bg-emerald-500/15 text-emerald-200" : "bg-white/10"}`}>{state}</span>
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{k.prefix}…</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <span key={s} className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[11px]">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>Last used {when(k.lastUsedAt)}</p>
                    <p>
                      Made by {k.createdByName} · {when(k.createdAt)}
                    </p>
                    {k.expiresAt && <p>Expires {when(k.expiresAt)}</p>}
                  </div>
                  {state === "Active" && <Confirm label={<><Trash2 className="h-3.5 w-3.5" /> Revoke</>} confirmLabel="Revoke now?" onConfirm={() => void revoke(k.id)} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

function Deliveries({ endpointId, refreshKey }: { endpointId: string; refreshKey: number }) {
  const [rows, setRows] = useState<DeliveryRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    const d = (await (await fetch(`/api/developers/webhooks/${endpointId}/deliveries`, { cache: "no-store" })).json()) as { ok: boolean; deliveries: DeliveryRow[] };
    if (d.ok) setRows(d.deliveries);
  }, [endpointId]);
  useEffect(() => void load(), [load, refreshKey]);

  async function resend(id: string) {
    setNote(null);
    const d = (await (await fetch(`/api/developers/deliveries/${id}`, { method: "POST" })).json()) as { ok: boolean; delivered?: boolean; error?: string | null; statusCode?: number | null };
    setNote(d.ok ? (d.delivered ? "Delivered." : `Still failing: ${d.error ?? d.statusCode ?? "no answer"}. It will be retried.`) : d.error ?? "Could not resend.");
    await load();
  }

  if (!rows) return <p className="mt-2 text-xs text-muted-foreground">Loading deliveries…</p>;
  if (rows.length === 0) return <p className="mt-2 text-xs text-muted-foreground">No deliveries yet. Events show up here within about 5 minutes of happening.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
      <table className="w-full min-w-[560px] text-left text-xs" data-testid="delivery-table">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1.5 font-medium">Event</th>
            <th className="font-medium">When</th>
            <th className="font-medium">Result</th>
            <th className="font-medium">Tries</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5 font-mono">{r.event}</td>
              <td>{when(r.createdAt)}</td>
              <td>
                {r.status === "succeeded" ? (
                  <span className="text-emerald-300">
                    {r.lastStatusCode ?? "OK"} · {r.responseMs ?? 0} ms
                  </span>
                ) : r.status === "pending" ? (
                  <span className="text-amber-200" title={r.lastError ?? undefined}>
                    {r.attempts === 0 ? "Waiting" : `Retrying ${when(r.nextAttemptAt)}`}
                    {r.lastError ? ` — ${r.lastError}` : ""}
                  </span>
                ) : (
                  <span className="text-red-300" title={r.lastError ?? undefined}>
                    Failed{r.lastError ? ` — ${r.lastError}` : ""}
                  </span>
                )}
              </td>
              <td>
                {r.attempts}/{WEBHOOK_MAX_ATTEMPTS}
              </td>
              <td className="text-right">
                {r.status !== "pending" && (
                  <button type="button" className="text-xs text-violet-300 hover:underline" onClick={() => void resend(r.id)}>
                    Resend
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventPicker({ value, onChange }: { value: WebhookEventName[]; onChange: (v: WebhookEventName[]) => void }) {
  const all = value.length === WEBHOOK_EVENTS.length;
  return (
    <fieldset>
      <legend className="flex w-full items-center justify-between text-sm">
        Events
        <button type="button" className="text-xs text-violet-300 hover:underline" onClick={() => onChange(all ? [] : [...WEBHOOK_EVENTS])}>
          {all ? "Clear" : "Select all"}
        </button>
      </legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {WEBHOOK_EVENTS.map((e) => (
          <label key={e} className={`flex cursor-pointer gap-3 rounded-xl border p-2.5 text-sm ${value.includes(e) ? "border-violet-400/60 bg-violet-500/10" : "border-white/10"}`}>
            <input type="checkbox" className="mt-0.5" checked={value.includes(e)} onChange={() => onChange(value.includes(e) ? value.filter((x) => x !== e) : [...value, e])} />
            <span>
              <code className="text-xs">{e}</code>
              <span className="block text-xs text-muted-foreground">{WEBHOOK_EVENT_LABELS[e]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function EndpointCard({ ep, onChanged }: { ep: EndpointRow; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [events, setEvents] = useState<WebhookEventName[]>(ep.events);
  const [secret, setSecret] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  async function call(path: string, init: RequestInit, label: string) {
    setBusy(label);
    setResult(null);
    try {
      const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" } });
      return (await res.json()) as Record<string, unknown> & { ok: boolean; error?: string };
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    const d = await call(`/api/developers/webhooks/${ep.id}/test`, { method: "POST" }, "test");
    if (!d.ok) setResult({ ok: false, text: d.error ?? "Could not send." });
    else if (d.delivered) setResult({ ok: true, text: `Delivered — your endpoint answered ${d.statusCode} in ${d.ms} ms.` });
    else setResult({ ok: false, text: `Not delivered: ${String(d.error ?? "no answer")}` });
    setOpen(true);
    setRefresh((n) => n + 1);
    await onChanged();
  }

  async function secretAction(action: "reveal" | "rotate") {
    const d = await call(`/api/developers/webhooks/${ep.id}/secret`, { method: "POST", body: JSON.stringify({ action }) }, action);
    if (d.ok) setSecret(String(d.secret));
    else setResult({ ok: false, text: d.error ?? "Could not get the secret." });
  }

  async function patch(body: Record<string, unknown>, label: string) {
    const d = await call(`/api/developers/webhooks/${ep.id}`, { method: "PATCH", body: JSON.stringify(body) }, label);
    if (!d.ok) setResult({ ok: false, text: d.error ?? "Could not save." });
    else setEditing(false);
    await onChanged();
  }

  async function remove() {
    const d = await call(`/api/developers/webhooks/${ep.id}`, { method: "DELETE" }, "delete");
    if (!d.ok) setResult({ ok: false, text: d.error ?? "Could not delete." });
    await onChanged();
  }

  const host = (() => {
    try {
      return new URL(ep.url).host;
    } catch {
      return ep.url;
    }
  })();

  return (
    <li className="rounded-xl border border-white/10 p-4" data-testid="endpoint-row">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {ep.description || host}{" "}
            <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${ep.active ? "bg-emerald-500/15 text-emerald-200" : "bg-red-500/15 text-red-200"}`}>{ep.active ? "On" : "Off"}</span>
          </p>
          <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">{ep.url}</p>
          {!ep.active && ep.disabledReason && <p className="mt-1 text-xs text-red-200">{ep.disabledReason}</p>}
          {ep.active && ep.consecutiveFailures >= 5 && (
            <p className="mt-1 text-xs text-amber-200">{ep.consecutiveFailures} failed attempts in a row — check your endpoint. It turns off at 50.</p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-center text-xs">
          <div>
            <p className="text-base font-semibold text-emerald-300">{ep.stats.succeeded24h}</p>
            <p className="text-muted-foreground">delivered 24h</p>
          </div>
          <div>
            <p className={`text-base font-semibold ${ep.stats.failed24h ? "text-red-300" : ""}`}>{ep.stats.failed24h}</p>
            <p className="text-muted-foreground">failed 24h</p>
          </div>
          <div>
            <p className="text-base font-semibold">{ep.stats.pending}</p>
            <p className="text-muted-foreground">waiting</p>
          </div>
        </div>
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
          <EventPicker value={events} onChange={setEvents} />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => void patch({ events }, "events")} disabled={events.length === 0 || busy !== null}>
              Save events
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => (setEditing(false), setEvents(ep.events))}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          {ep.events.map((e) => (
            <span key={e} className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[11px]">
              {e}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => void test()} disabled={busy !== null} data-testid="send-test">
          {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide deliveries" : "Deliveries"}
        </Button>
        {!editing && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit events
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={() => void secretAction("reveal")} disabled={busy !== null}>
          Signing secret
        </Button>
        <Confirm label={<><RotateCw className="h-3.5 w-3.5" /> Rotate secret</>} confirmLabel="Rotate? Old one stops working" onConfirm={() => void secretAction("rotate")} danger={false} />
        <Button type="button" size="sm" variant="ghost" onClick={() => void patch({ active: !ep.active }, "toggle")} disabled={busy !== null}>
          {ep.active ? "Turn off" : "Turn on"}
        </Button>
        <span className="ml-auto">
          <Confirm label={<><Trash2 className="h-3.5 w-3.5" /> Delete</>} confirmLabel="Delete webhook?" onConfirm={() => void remove()} />
        </span>
      </div>
      {result && <p className={`mt-2 text-sm ${result.ok ? "text-emerald-300" : "text-red-300"}`} data-testid="test-result">{result.text}</p>}
      {secret && <div className="mt-3"><Secret title="Signing secret" value={secret} note="Use it to check the Guma-Signature header on every request (see Docs)." /></div>}
      {open && <Deliveries endpointId={ep.id} refreshKey={refresh} />}
    </li>
  );
}

function WebhooksTab() {
  const [endpoints, setEndpoints] = useState<EndpointRow[] | null>(null);
  const [allowLocal, setAllowLocal] = useState(false);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<WebhookEventName[]>(["order.created", "order.paid"]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = (await (await fetch("/api/developers/webhooks", { cache: "no-store" })).json()) as { ok: boolean; endpoints: EndpointRow[]; allowLocal: boolean; error?: string };
    if (d.ok) {
      setEndpoints(d.endpoints);
      setAllowLocal(d.allowLocal);
    } else setMsg(d.error ?? "Could not load webhooks.");
  }, []);
  useEffect(() => void load(), [load]);

  async function add() {
    setBusy(true);
    setMsg(null);
    const d = (await (
      await fetch("/api/developers/webhooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, description: description || undefined, events }) })
    ).json()) as { ok: boolean; secret?: string; error?: string };
    setBusy(false);
    if (!d.ok) return setMsg(d.error ?? "Could not add the webhook.");
    setCreated(d.secret ?? null);
    setUrl("");
    setDescription("");
    await load();
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Webhook className="h-4 w-4" /> Add a webhook
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          We POST a signed JSON event to your URL when something happens — new order, payment, delivery update, stock change. Works with Zapier, Make, n8n,
          Google Apps Script or your own server.
        </p>
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <label className="block text-sm">
              URL
              <input className="guma-field mt-1 h-10 w-full font-mono text-xs" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…" data-testid="webhook-url" />
              <span className="mt-1 block text-xs text-muted-foreground">Public HTTPS only{allowLocal ? " (local dev: http://localhost also works)" : ""}.</span>
            </label>
            <label className="block text-sm">
              Label (optional)
              <input className="guma-field mt-1 h-10 w-full" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Google Sheets" maxLength={120} />
            </label>
          </div>
          <EventPicker value={events} onChange={setEvents} />
          <Button type="button" onClick={add} disabled={busy || !url.trim() || events.length === 0} data-testid="add-webhook">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add webhook
          </Button>
          {msg && <p className="text-sm text-red-300" data-testid="webhook-error">{msg}</p>}
          {created && <Secret title="Signing secret" value={created} note="Your endpoint uses this to check each request really came from Guma Kart. You can show it again later." />}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Webhooks</h2>
        {!endpoints ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : endpoints.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No webhooks yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {endpoints.map((ep) => (
              <EndpointCard key={ep.id} ep={ep} onChanged={load} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ─── Docs ────────────────────────────────────────────────────────────────────

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl bg-black/40 p-3 text-xs leading-relaxed">
        <code>{children}</code>
      </pre>
      <span className="absolute right-2 top-2">
        <CopyButton text={children} />
      </span>
    </div>
  );
}

const ENDPOINTS: Array<[string, string, string, string]> = [
  ["GET", "/shop", "any", "Which shop this key belongs to, and its permissions."],
  ["GET", "/orders", "orders:read", "Newest first. Filters: order_state, payment_state, fulfillment_state, channel, created_after, created_before."],
  ["GET", "/orders/{id or number}", "orders:read", "One order with items, buyer and address."],
  ["POST", "/orders/{id}/actions", "orders:write", "accept, mark_ready, mark_out_for_delivery, mark_delivered, mark_failed_delivery, mark_returned."],
  ["GET", "/products", "products:read", "With variants, prices and photos. Filter: status."],
  ["GET", "/products/{id}", "products:read", "One product."],
  ["GET", "/inventory", "inventory:read", "Stock per variant. Filters: sku, barcode."],
  ["PUT", "/inventory", "inventory:write", "Set counted stock: { items: [{ sku | variant_id, stock }] }, up to 500, all or nothing."],
  ["GET", "/customers", "customers:read", "Buyers with order count, total spent, SMS consent. Filter: phone."],
  ["GET", "/customers/{id}", "customers:read", "One buyer."],
];

function DocsTab() {
  const base = typeof window !== "undefined" ? `${window.location.origin}/api/v1` : "https://admin.guma.one/api/v1";
  return (
    <Card className="space-y-6 p-5 text-sm leading-relaxed" data-testid="api-docs">
      <section>
        <h2 className="font-semibold">Getting started</h2>
        <p className="mt-1 text-muted-foreground">
          Base URL <code className="text-foreground">{base}</code>. Send your key in the <code>Authorization</code> header. JSON in, JSON out; money is a string with 2 decimals in
          pesos (<code>&quot;682.30&quot;</code>); times are ISO 8601 (UTC). Server-to-server only — never put a key in a web page or app.
        </p>
        <div className="mt-3">
          <Code>{`curl ${base}/orders?payment_state=paid&limit=20 \\\n  -H "Authorization: Bearer gk_live_…"`}</Code>
        </div>
        <p className="mt-2 text-muted-foreground">
          Machine-readable description (OpenAPI 3.1):{" "}
          <a className="text-violet-300 underline" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
            /api/v1/openapi.json
          </a>
        </p>
      </section>

      <section>
        <h2 className="font-semibold">Endpoints</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1.5 font-medium">Method</th>
                <th className="font-medium">Path</th>
                <th className="font-medium">Permission</th>
                <th className="font-medium">What it does</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {ENDPOINTS.map(([m, p, s, d]) => (
                <tr key={`${m} ${p}`}>
                  <td className="py-1.5 font-mono">{m}</td>
                  <td className="font-mono">{p}</td>
                  <td className="font-mono text-muted-foreground">{s}</td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-semibold">Pages, errors and limits</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            Lists return <code>{`{ data: [...], next_cursor }`}</code>. Pass <code>cursor=next_cursor</code> for the next page; <code>limit</code> is 1–100 (default 50).
          </li>
          <li>
            Errors return <code>{`{ error: { code, message } }`}</code> with 400 (bad input), 401 (bad key), 403 (missing permission), 404, 409 (order can&apos;t move to that
            step) or 429.
          </li>
          <li>120 requests per minute per key. On 429, wait for the <code>Retry-After</code> seconds.</li>
          <li>Payments, cancellations and refunds can&apos;t be done through the API — they stay in Guma Kart.</li>
          <li>Every API change (order steps, stock) is in Settings → Activity as &ldquo;API · key name&rdquo;.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-semibold">Webhooks</h2>
        <p className="mt-1 text-muted-foreground">
          Each event is a POST with this body. <code>data.object</code> is the order, stock row or customer exactly as the API returns it, at the time the event was
          sent. Events usually arrive within 5 minutes and may arrive out of order — use <code>created_at</code>, or fetch the latest from the API.
        </p>
        <div className="mt-3">
          <Code>{`{
  "id": "6f0c…",                 // event id — use it to ignore duplicates
  "type": "order.paid",
  "created_at": "2026-10-05T03:12:44.120Z",
  "shop": { "id": "…", "slug": "your-shop" },
  "data": { "object": { "id": "…", "number": "0042", "total": "682.30", … } }
}`}</Code>
        </div>
        <p className="mt-3 text-muted-foreground">
          Headers: <code>Guma-Event</code>, <code>Guma-Event-Id</code>, <code>Guma-Delivery</code>, <code>Guma-Attempt</code> and <code>Guma-Signature: t=…,v1=…</code>. Reply
          with any 2xx within 10 seconds. Otherwise we retry after 1, 5, 15 and 60 minutes, then 3, 6, 12 and 18 hours ({WEBHOOK_MAX_ATTEMPTS} tries in all). A webhook that
          fails 50 times in a row is turned off — fix it and turn it back on.
        </p>
        <p className="mt-3 font-medium">Check the signature (Node.js)</p>
        <div className="mt-2">
          <Code>{`import crypto from "node:crypto";

// rawBody: the exact request body string (before JSON.parse)
export function isFromGuma(rawBody, signatureHeader, secret) {
  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false; // older than 5 min
  const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  return parts.v1?.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
}`}</Code>
        </div>
      </section>
    </Card>
  );
}

export function DevelopersView() {
  const [tab, setTab] = useState<Tab>("keys");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "webhooks" || t === "docs" || t === "keys") setTab(t);
  }, []);
  const tabs: Array<[Tab, string]> = [
    ["keys", "API keys"],
    ["webhooks", "Webhooks"],
    ["docs", "Docs"],
  ];
  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-24">
      <p className="text-sm text-muted-foreground">
        Connect Guma Kart to your other tools — accounting, Google Sheets, a fulfilment partner, Zapier, Make or n8n. Only the shop owner can see this page.
      </p>
      <div className="flex gap-1 rounded-xl border border-white/10 p-1" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${tab === id ? "bg-white/10" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => {
              setTab(id);
              window.history.replaceState(null, "", `?tab=${id}`);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "keys" ? <KeysTab /> : tab === "webhooks" ? <WebhooksTab /> : <DocsTab />}
    </div>
  );
}
