"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BellRing, MessageSquareText, RotateCcw, Send } from "lucide-react";
import { Card, formatPrice } from "@gumakart/ui";

/**
 * Phase 4 — Auto SMS. What gets texted to buyers (on/off per recipe, with a
 * sample), alerts to the seller, 30-day numbers and the shop's SMS log.
 */

interface Recipe {
  id: string;
  label: string;
  when: string;
  kind: "transactional" | "marketing";
  enabled: boolean;
  example: string;
}

interface MessageRow {
  id: string;
  recipe: string;
  recipient: string;
  status: string;
  error: string | null;
  orderNumber: string | null;
  createdAt: string;
}

interface Data {
  ok: boolean;
  error?: string;
  recipes: Recipe[];
  seller: { smsOnNewOrder: boolean; mobile: string | null };
  smsLive: boolean;
  email?: { enabled: boolean; live: boolean };
  summary: { sent30d: number; failed30d: number; byRecipe: Record<string, number>; recovered: { orders: number; sales: number } };
  messages: MessageRow[];
}

const RECIPE_NAMES: Record<string, string> = {
  order_created: "Order received",
  payment_confirmed: "Payment confirmed",
  shipped: "Rider booked / pickup ready",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  abandoned_checkout: "Unfinished checkout",
  unpaid_reminder: "Unpaid reminder",
  seller_new_order: "Alert to you: new order",
  seller_payment_proof: "Alert to you: payment proof",
  seller_delivery_failed: "Alert to you: delivery failed",
  seller_payment_received: "Alert to you: paid online",
  email_order_created: "Email: order received",
  email_payment_confirmed: "Email: payment confirmed",
  email_shipped: "Email: rider booked / pickup ready",
  email_out_for_delivery: "Email: out for delivery",
  email_delivered: "Email: delivered",
  pos_receipt: "POS receipt (text)",
  pos_receipt_email: "POS receipt (email)",
};

const STATUS_STYLE: Record<string, string> = {
  sent: "bg-emerald-500/15 text-emerald-300",
  delivered: "bg-emerald-500/15 text-emerald-300",
  queued: "bg-slate-500/20 text-slate-300",
  suppressed: "bg-amber-500/15 text-amber-300",
  failed: "bg-red-500/15 text-red-300",
  mock: "bg-sky-500/15 text-sky-300",
};

const STATUS_LABEL: Record<string, string> = {
  sent: "Sent",
  delivered: "Delivered",
  queued: "Sending",
  suppressed: "Buyer opted out",
  failed: "Not sent",
  mock: "Test only",
};

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? "bg-primary" : "bg-white/15"} disabled:opacity-50`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${on ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function AutomationsView() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/automations", { cache: "no-store" });
      const json = (await res.json()) as Data;
      if (!json.ok) throw new Error(json.error ?? "Could not load.");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(key: string, settings: Record<string, unknown>, apply: (d: Data) => Data) {
    if (!data) return;
    const before = data;
    setData(apply(data));
    setSaving(key);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Could not save.");
    } catch (e) {
      setData(before);
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(null);
    }
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>;
  }

  const transactional = data.recipes.filter((r) => r.kind === "transactional");
  const marketing = data.recipes.filter((r) => r.kind === "marketing");

  const recipeRow = (r: Recipe) => (
    <li key={r.id} className="py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{r.label}</p>
          <p className="text-sm text-muted-foreground">{r.when}</p>
          <button
            type="button"
            className="mt-1 text-xs font-medium text-violet-300 hover:text-violet-200"
            onClick={() => setOpen(open === r.id ? null : r.id)}
          >
            {open === r.id ? "Hide sample" : "See sample text"}
          </button>
          {open === r.id && (
            <p className="mt-2 rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs leading-relaxed text-slate-200 break-words">
              {r.example}
            </p>
          )}
        </div>
        <Toggle
          on={r.enabled}
          label={r.label}
          disabled={saving === r.id}
          onChange={(v) =>
            void patch(r.id, { automations: { [r.id]: v } }, (d) => ({
              ...d,
              recipes: d.recipes.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)),
            }))
          }
        />
      </div>
    </li>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p className="text-sm text-muted-foreground">
        Buyers get a text at each step, from your shop&apos;s name — so they don&apos;t have to chat you
        &ldquo;nasaan na po?&rdquo;. Turn off anything you&apos;d rather text yourself.
      </p>

      {!data.smsLive && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>SMS sending isn&apos;t connected yet, so texts show below as &ldquo;Not sent&rdquo;. Your settings are saved and start working once it&apos;s on.</span>
        </div>
      )}
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <Send className="h-4 w-4 text-violet-300" />
          <p className="mt-2 text-2xl font-bold">{data.summary.sent30d}</p>
          <p className="text-xs text-muted-foreground">Texts sent · 30 days</p>
        </Card>
        <Card className="p-4">
          <RotateCcw className="h-4 w-4 text-emerald-300" />
          <p className="mt-2 text-2xl font-bold">{data.summary.recovered.orders}</p>
          <p className="text-xs text-muted-foreground">
            Recovered checkouts{data.summary.recovered.sales > 0 ? ` · ${formatPrice(data.summary.recovered.sales)}` : ""}
          </p>
        </Card>
        <Card className="p-4">
          <AlertTriangle className="h-4 w-4 text-amber-300" />
          <p className="mt-2 text-2xl font-bold">{data.summary.failed30d}</p>
          <p className="text-xs text-muted-foreground">Not sent · 30 days</p>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <MessageSquareText className="h-4 w-4" /> Order updates to buyers
        </h2>
        <ul className="mt-2 divide-y divide-white/10">{transactional.map(recipeRow)}</ul>
        {data.email && (
          <div className="mt-3 flex items-start gap-3 border-t border-white/10 pt-3" data-testid="email-copies">
            <div className="min-w-0 flex-1">
              <p className="font-medium">Email copies</p>
              <p className="text-sm text-muted-foreground">
                When the buyer types an email at checkout, they also get each update by email — with the full item list. Free.
                {!data.email.live ? " Email sending isn't connected yet; it starts once it is." : ""}
              </p>
            </div>
            <Toggle
              on={data.email.enabled}
              label="Email copies"
              disabled={saving === "email"}
              onChange={(v) =>
                void patch("email", { automations: { email_copies: v } }, (d) => ({ ...d, email: { ...(d.email ?? { live: false }), enabled: v } }))
              }
            />
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <RotateCcw className="h-4 w-4" /> Reminders
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Only to buyers who ticked &ldquo;text me reminders&rdquo; at checkout. Max 2 per checkout, never
          9 PM–8 AM, and every reminder has a &ldquo;Stop reminders&rdquo; link.
        </p>
        <ul className="mt-2 divide-y divide-white/10">{marketing.map(recipeRow)}</ul>
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <BellRing className="h-4 w-4" /> Alerts to you
        </h2>
        <div className="mt-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Text me too</p>
            <p className="text-sm text-muted-foreground">
              New COD order, payment proof sent, delivery failed. Phone alerts (push) are always on when you allow
              notifications.{" "}
              {data.seller.mobile ? (
                <>Texts go to <span className="font-medium text-foreground">{data.seller.mobile}</span>.</>
              ) : (
                <>
                  <Link href="/settings/shop" className="font-medium text-violet-300 hover:text-violet-200">
                    Add your mobile number
                  </Link>{" "}
                  first.
                </>
              )}
            </p>
          </div>
          <Toggle
            on={data.seller.smsOnNewOrder}
            label="Text me too"
            disabled={saving === "seller"}
            onChange={(v) =>
              void patch("seller", { notifications: { smsOnNewOrder: v } }, (d) => ({
                ...d,
                seller: { ...d.seller, smsOnNewOrder: v },
              }))
            }
          />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Recent texts</h2>
        {data.messages.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No texts yet. They show here as orders come in.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/10">
            {data.messages.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <span className="w-28 shrink-0 text-xs text-muted-foreground">{when(m.createdAt)}</span>
                <span className="min-w-0 flex-1">
                  {RECIPE_NAMES[m.recipe] ?? m.recipe}
                  {m.orderNumber ? <span className="text-muted-foreground"> · #{m.orderNumber}</span> : null}
                  <span className="text-muted-foreground"> · {m.recipient}</span>
                </span>
                {(() => {
                  const status = m.status === "sent" && m.error?.startsWith("mock send") ? "mock" : m.status;
                  return (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.queued}`}
                      title={m.error ?? undefined}
                    >
                      {STATUS_LABEL[status] ?? status}
                    </span>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
