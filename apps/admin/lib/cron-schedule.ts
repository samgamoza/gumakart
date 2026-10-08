/**
 * Phase 16 — which /api/cron/* jobs run when. Pure (no imports) so the cron worker entry,
 * the ops monitor and the tests share one list.
 *
 * Cloudflare's free plan allows 5 cron triggers per account (Kuya Eddie uses one), so
 * wrangler.jsonc has ONE every-minute trigger and `due()` picks the jobs for that minute.
 * `maxGapMinutes` is how long a job may go without running before the monitor raises an alert.
 */
export interface CronJob {
  path: string;
  /** Due at this UTC minute (already rounded down to the minute). */
  due: (t: Date) => boolean;
  maxGapMinutes: number;
}

const every = (n: number) => (t: Date) => t.getUTCMinutes() % n === 0;
const hourlyAt = (m: number) => (t: Date) => t.getUTCMinutes() === m;

export const CRON_JOBS: CronJob[] = [
  // Order events → Inngest (or the event log): buyer SMS/email follow from these. Every minute.
  { path: "/api/cron/outbox", due: () => true, maxGapMinutes: 10 },
  // Phase 15: webhooks — fan out new events and send due deliveries. Every minute.
  { path: "/api/cron/webhooks", due: () => true, maxGapMinutes: 10 },
  // Timed SMS: unfinished checkout (30 min / 24 h) + unpaid reminder (6 h). Every 5 minutes.
  { path: "/api/cron/automations", due: every(5), maxGapMinutes: 20 },
  // Phase 13: Shopee/Lazada stock push + order import. Every 5 minutes.
  { path: "/api/cron/marketplaces", due: every(5), maxGapMinutes: 20 },
  // Phase 14: SMS campaigns (quiet hours respected inside). Every 5 minutes.
  { path: "/api/cron/campaigns", due: every(5), maxGapMinutes: 20 },
  // Phase 27: Suki loyalty points for paid orders (and take-backs). Every 5 minutes.
  { path: "/api/cron/loyalty", due: every(5), maxGapMinutes: 20 },
  // Unpaid orders past each shop's window (1–72 h) → cancelled + restocked. Hourly.
  { path: "/api/cron/expire-orders", due: hourlyAt(20), maxGapMinutes: 130 },
  // Wallet: release cleared earnings / payouts (no-op while WALLET_PAYOUTS_ENABLED=false). Hourly.
  { path: "/api/cron/wallet-settlement", due: hourlyAt(40), maxGapMinutes: 130 },
  // Phase 16: plan reminders, grace period, downgrade after grace. Hourly.
  { path: "/api/cron/billing", due: hourlyAt(50), maxGapMinutes: 130 },
  // Security G3: audit chain verification, daily at 18:15 UTC (02:15 Manila).
  { path: "/api/cron/audit-chain", due: (t) => t.getUTCHours() === 18 && t.getUTCMinutes() === 15, maxGapMinutes: 26 * 60 },
  // AI agents — same times as the old vercel.json (UTC).
  { path: "/api/cron/agent-reminders", due: (t) => t.getUTCHours() === 9 && t.getUTCMinutes() === 0, maxGapMinutes: 26 * 60 },
  { path: "/api/cron/agents?mode=daily", due: (t) => t.getUTCHours() === 10 && t.getUTCMinutes() === 0, maxGapMinutes: 26 * 60 },
  {
    path: "/api/cron/agents?mode=weekly",
    due: (t) => t.getUTCDay() === 1 && t.getUTCHours() === 2 && t.getUTCMinutes() === 0,
    maxGapMinutes: 8 * 24 * 60,
  },
];

/** Every tick ends by reporting the runs to this route (records them, then checks alerts). */
export const CRON_REPORT_PATH = "/api/cron/ops";

export function dueJobs(scheduledTime: number): CronJob[] {
  const t = new Date(Math.floor(scheduledTime / 60_000) * 60_000);
  return CRON_JOBS.filter((job) => job.due(t));
}

export function cronExpectations(): Record<string, number> {
  return Object.fromEntries(CRON_JOBS.map((j) => [j.path, j.maxGapMinutes]));
}

/** A short, secret-free summary of a job's JSON reply for the run history. */
export function summarizeCronBody(body: string): string {
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const parts = Object.entries(json)
      .filter(([k, v]) => k !== "ok" && (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 80)))
      .slice(0, 8)
      .map(([k, v]) => `${k}=${v}`);
    return parts.join(" ").slice(0, 300) || "ok";
  } catch {
    return body.replace(/\s+/g, " ").slice(0, 200);
  }
}
