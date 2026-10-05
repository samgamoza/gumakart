import { getOpsSnapshot, listAppErrors, listOpsAlerts } from "@gumakart/db";
import { getIntegrationReport } from "@gumakart/services";
import { requireSuperAdmin } from "@/lib/session";
import { PlatformShell } from "@/components/platform-shell";
import { Panel, SectionHeader, StatCard } from "@/components/ui";
import { ResolveErrorButton } from "@/components/resolve-error-button";

export const dynamic = "force-dynamic";

const ago = (d: Date | null) => {
  if (!d) return "never";
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/**
 * Phase 16 — is everything running? Alerts (opened and resolved by the cron monitor every
 * minute), background jobs, queues, SMS, server errors and provider setup.
 */
export default async function SystemPage() {
  const session = await requireSuperAdmin();
  const [snap, alerts, errors] = await Promise.all([getOpsSnapshot(), listOpsAlerts({ days: 7 }), listAppErrors({ limit: 30 })]);
  const report = getIntegrationReport();
  const smsTotal = snap.sms.sent1h + snap.sms.failed1h;

  return (
    <PlatformShell title="System health" subtitle="Alerts, background jobs, queues and errors — checked every minute" user={{ displayName: session.displayName, email: session.email }}>
      <div className="space-y-6">
        <Panel className={alerts.open.length ? "border-rose-300" : "border-emerald-300"}>
          <SectionHeader
            title={alerts.open.length ? `${alerts.open.length} open alert${alerts.open.length === 1 ? "" : "s"}` : "All good"}
            description={`Alerts email ${process.env.OPS_ALERT_EMAIL || process.env.HELPDESK_NOTIFY_EMAIL ? "the ops inbox" : "nobody yet — set OPS_ALERT_EMAIL"} when they open and close.`}
          />
          {alerts.open.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open alerts.</p>
          ) : (
            <ul className="space-y-2" data-testid="open-alerts">
              {alerts.open.map((a) => (
                <li key={a.id} className={`rounded-xl border p-3 ${a.severity === "critical" ? "border-rose-300 bg-rose-500/10" : "border-amber-300 bg-amber-500/10"}`}>
                  <p className="text-sm font-semibold">
                    <span className="mr-2 rounded-full bg-background px-2 py-0.5 text-[11px] uppercase">{a.severity}</span>
                    {a.title}
                  </p>
                  {a.detail && <p className="mt-1 text-xs text-muted-foreground">{a.detail}</p>}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Since {ago(a.openedAt)} · checked {ago(a.lastSeenAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {alerts.recent.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-xs text-muted-foreground">Resolved in the last 7 days ({alerts.recent.length})</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {alerts.recent.map((a) => (
                  <li key={a.id}>
                    ✓ {a.title} — open {Math.max(1, Math.round(((a.resolvedAt?.getTime() ?? 0) - a.openedAt.getTime()) / 60_000))} min, fixed {ago(a.resolvedAt)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Panel>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Order events waiting" value={snap.outbox.pending} sub={snap.outbox.stuck ? `${snap.outbox.stuck} gave up` : snap.outbox.pending ? `oldest ${snap.outbox.oldestPendingMinutes} min` : "none stuck"} tone={snap.outbox.stuck ? "rose" : "emerald"} />
          <StatCard label="Webhook queue" value={snap.webhooks.unfanned + snap.webhooks.pendingDeliveries} sub={`${snap.webhooks.pendingDeliveries} deliveries retrying`} tone="sky" />
          <StatCard label="SMS last hour" value={smsTotal} sub={smsTotal ? `${snap.sms.failed1h} failed` : "none sent"} tone={smsTotal && snap.sms.failed1h / smsTotal > 0.25 ? "rose" : "violet"} />
          <StatCard label="Open server errors" value={snap.errors.open} sub={`${snap.errors.last15m} seen in 15 min`} tone={snap.errors.last15m ? "amber" : "emerald"} />
        </div>

        <Panel>
          <SectionHeader title="Background jobs" description="Every run is recorded by the cron worker (one trigger, every minute)" />
          {snap.cron.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs recorded yet. They appear once the admin Worker&apos;s cron trigger runs.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm" data-testid="cron-table">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 font-medium">Job</th>
                    <th className="font-medium">Last run</th>
                    <th className="font-medium">Result</th>
                    <th className="font-medium">Runs / failed (24 h)</th>
                    <th className="font-medium">Avg time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {snap.cron.map((j) => (
                    <tr key={j.job}>
                      <td className="py-2 font-mono text-xs">{j.job.replace("/api/cron/", "")}</td>
                      <td>{ago(j.lastRunAt)}</td>
                      <td className="max-w-[280px] truncate text-xs" title={j.lastSummary ?? ""}>
                        <span className={j.lastOk ? "text-emerald-600" : "text-rose-600"}>{j.lastOk ? "OK" : "Failed"}</span> {j.lastSummary}
                      </td>
                      <td>
                        {j.runs24h} / <span className={j.failures24h ? "text-rose-600" : ""}>{j.failures24h}</span>
                      </td>
                      <td>{j.avgMs24h == null ? "—" : j.avgMs24h < 1000 ? `${j.avgMs24h} ms` : `${(j.avgMs24h / 1000).toFixed(1)} s`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          <SectionHeader title="Server errors" description="Grouped by app, route and message. Mark fixed after a deploy; it reopens if it happens again." />
          {errors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open errors.</p>
          ) : (
            <ul className="divide-y divide-border" data-testid="error-list">
              {errors.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{e.message}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {e.app} · {e.route ?? "—"}
                    </p>
                    {e.stack && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-muted-foreground">Stack</summary>
                        <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-muted p-2 text-[11px]">{e.stack}</pre>
                      </details>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>
                      {e.count}× · last {ago(e.lastSeenAt)}
                    </p>
                    <p>first {ago(e.firstSeenAt)}</p>
                  </div>
                  <ResolveErrorButton id={e.id} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <SectionHeader title="Providers" description={`Runtime: ${report.mode}${report.allowMocks ? " (labeled mocks allowed)" : ""}. Secrets are never shown.`} />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {report.checks.map((c) => (
              <div key={c.id} className="rounded-xl border border-border p-3 text-sm">
                <p className="flex items-center justify-between gap-2 font-medium">
                  {c.label}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${c.configured ? "bg-emerald-500/15 text-emerald-700" : c.severity === "required" ? "bg-rose-500/15 text-rose-700" : "bg-muted text-muted-foreground"}`}>
                    {c.configured ? "configured" : c.status.replace("_", " ")}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{c.message}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </PlatformShell>
  );
}
