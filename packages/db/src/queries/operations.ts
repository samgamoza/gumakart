import { and, asc, desc, eq, gt, gte, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "../client";
import { appErrors, cronRuns, domainEvents, messageLog, opsAlerts, webhookEvents } from "../schema/index";
import { OUTBOX_MAX_ATTEMPTS } from "./outbox";

/**
 * Phase 16 — operations: cron run history, captured server errors, and alert rules that open
 * and resolve `ops_alerts` by themselves. The cron worker reports every job run to
 * /api/cron/ops, which records the runs and then evaluates the rules.
 */

// ─── Cron runs ───────────────────────────────────────────────────────────────

export interface CronRunInput {
  job: string;
  startedAt: Date;
  durationMs: number;
  ok: boolean;
  statusCode?: number | null;
  summary?: string | null;
}

export async function recordCronRuns(runs: CronRunInput[]): Promise<number> {
  const rows = runs
    .filter((r) => r.job && Number.isFinite(r.durationMs))
    .slice(0, 50)
    .map((r) => ({
      job: r.job.slice(0, 80),
      startedAt: r.startedAt,
      durationMs: Math.max(0, Math.round(r.durationMs)),
      ok: r.ok,
      statusCode: r.statusCode ?? null,
      summary: r.summary?.slice(0, 500) ?? null,
    }));
  if (rows.length === 0) return 0;
  await getDb().insert(cronRuns).values(rows);
  return rows.length;
}

/** Cron history is kept 14 days. */
export async function pruneCronRuns(now = new Date()): Promise<number> {
  const res = await getDb()
    .delete(cronRuns)
    .where(lt(cronRuns.startedAt, new Date(now.getTime() - 14 * 86_400_000)))
    .returning({ id: cronRuns.id });
  return res.length;
}

export interface CronJobStatus {
  job: string;
  lastRunAt: Date | null;
  lastOk: boolean | null;
  lastSummary: string | null;
  lastDurationMs: number | null;
  lastSuccessAt: Date | null;
  runs24h: number;
  failures24h: number;
  avgMs24h: number | null;
}

export async function listCronJobStatus(now = new Date()): Promise<CronJobStatus[]> {
  const since = new Date(now.getTime() - 86_400_000);
  const rows = await getDb().execute(sql`
    select j.job,
      l.started_at as "lastRunAt", l.ok as "lastOk", l.summary as "lastSummary", l.duration_ms as "lastDurationMs",
      (select max(started_at) from cron_runs s where s.job = j.job and s.ok) as "lastSuccessAt",
      (select count(*)::int from cron_runs d where d.job = j.job and d.started_at >= ${since.toISOString()}::timestamptz) as "runs24h",
      (select count(*)::int from cron_runs d where d.job = j.job and d.started_at >= ${since.toISOString()}::timestamptz and not d.ok) as "failures24h",
      (select avg(duration_ms)::int from cron_runs d where d.job = j.job and d.started_at >= ${since.toISOString()}::timestamptz) as "avgMs24h"
    from (select distinct job from cron_runs) j
    left join lateral (select * from cron_runs r where r.job = j.job order by r.started_at desc limit 1) l on true
    order by j.job
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    job: String(r.job),
    lastRunAt: r.lastRunAt ? new Date(String(r.lastRunAt)) : null,
    lastOk: r.lastOk == null ? null : Boolean(r.lastOk),
    lastSummary: (r.lastSummary as string | null) ?? null,
    lastDurationMs: r.lastDurationMs == null ? null : Number(r.lastDurationMs),
    lastSuccessAt: r.lastSuccessAt ? new Date(String(r.lastSuccessAt)) : null,
    runs24h: Number(r.runs24h ?? 0),
    failures24h: Number(r.failures24h ?? 0),
    avgMs24h: r.avgMs24h == null ? null : Number(r.avgMs24h),
  }));
}

// ─── App errors ──────────────────────────────────────────────────────────────

/** Strips ids, numbers and quoted values so the same bug groups into one row. */
export function normalizeErrorMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/"[^"]{0,200}"|'[^']{0,200}'/g, "<v>")
    .replace(/\b\d+(\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Never throws — error reporting must not cause a second error. */
const RECORDED = Symbol.for("gumakart.errorRecorded");

export async function recordAppError(input: { app: string; route?: string | null; error: unknown; now?: Date }): Promise<void> {
  try {
    const err = input.error instanceof Error ? input.error : new Error(String(input.error));
    // The same Error can reach here twice (console.error hook + an explicit capture): count it once.
    const marked = err as Error & { [RECORDED]?: boolean };
    if (marked[RECORDED]) return;
    marked[RECORDED] = true;
    const message = (err.message || err.name || "Unknown error").slice(0, 500);
    const route = input.route?.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "[id]").slice(0, 200) ?? null;
    const fingerprint = await sha256Hex(`${input.app}|${route ?? ""}|${err.name}|${normalizeErrorMessage(message)}`);
    const now = input.now ?? new Date();
    await getDb()
      .insert(appErrors)
      .values({ fingerprint, app: input.app.slice(0, 16), route, message, stack: err.stack?.slice(0, 4000) ?? null, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: appErrors.fingerprint,
        set: { count: sql`${appErrors.count} + 1`, lastSeenAt: now, resolvedAt: null, message, stack: err.stack?.slice(0, 4000) ?? null },
      });
  } catch (e) {
    console.error("[recordAppError] could not record", e);
  }
}

export interface AppErrorRow {
  id: string;
  app: string;
  route: string | null;
  message: string;
  stack: string | null;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
}

export async function listAppErrors(options: { includeResolved?: boolean; limit?: number } = {}): Promise<AppErrorRow[]> {
  const rows = await getDb()
    .select()
    .from(appErrors)
    .where(options.includeResolved ? undefined : isNull(appErrors.resolvedAt))
    .orderBy(desc(appErrors.lastSeenAt))
    .limit(Math.min(options.limit ?? 50, 200));
  return rows;
}

export async function resolveAppError(id: string): Promise<boolean> {
  const rows = await getDb().update(appErrors).set({ resolvedAt: new Date() }).where(eq(appErrors.id, id)).returning({ id: appErrors.id });
  return rows.length > 0;
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

export type AlertSeverity = "warning" | "critical";

export interface AlertCondition {
  key: string;
  severity: AlertSeverity;
  title: string;
  detail?: string;
}

/** How often each cron job must run (minutes) before it counts as missing. */
export type CronExpectations = Record<string, number>;

export interface OpsSnapshot {
  outbox: { pending: number; stuck: number; oldestPendingMinutes: number };
  webhooks: { unfanned: number; oldestUnfannedMinutes: number; pendingDeliveries: number };
  sms: { sent1h: number; failed1h: number };
  errors: { last15m: number; open: number };
  cron: CronJobStatus[];
}

export async function getOpsSnapshot(now = new Date()): Promise<OpsSnapshot> {
  const db = getDb();
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const quarterAgo = new Date(now.getTime() - 15 * 60_000);
  const [outbox] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${domainEvents.attempts} < ${OUTBOX_MAX_ATTEMPTS})::int`,
      stuck: sql<number>`count(*) filter (where ${domainEvents.attempts} >= ${OUTBOX_MAX_ATTEMPTS})::int`,
      oldest: sql<number>`coalesce(extract(epoch from ${now.toISOString()}::timestamptz - min(${domainEvents.createdAt}) filter (where ${domainEvents.attempts} < ${OUTBOX_MAX_ATTEMPTS})) / 60, 0)::int`,
    })
    .from(domainEvents)
    .where(isNull(domainEvents.publishedAt));
  const [hooks] = await db
    .select({
      unfanned: sql<number>`count(*)::int`,
      oldest: sql<number>`coalesce(extract(epoch from ${now.toISOString()}::timestamptz - min(${webhookEvents.createdAt})) / 60, 0)::int`,
    })
    .from(webhookEvents)
    .where(isNull(webhookEvents.fannedOutAt));
  const pendingRows = (await db.execute(sql`select count(*)::int as n from webhook_deliveries where status = 'pending'`)) as unknown as Array<{ n: number }>;
  const [sms] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${messageLog.status} in ('sent', 'delivered'))::int`,
      failed: sql<number>`count(*) filter (where ${messageLog.status} = 'failed')::int`,
    })
    .from(messageLog)
    .where(and(eq(messageLog.channel, "sms"), gte(messageLog.createdAt, hourAgo)));
  const [errs] = await db
    .select({
      recent: sql<number>`count(*) filter (where ${appErrors.lastSeenAt} >= ${quarterAgo.toISOString()}::timestamptz)::int`,
      open: sql<number>`count(*) filter (where ${appErrors.resolvedAt} is null)::int`,
    })
    .from(appErrors);
  return {
    outbox: { pending: outbox?.pending ?? 0, stuck: outbox?.stuck ?? 0, oldestPendingMinutes: outbox?.oldest ?? 0 },
    webhooks: { unfanned: hooks?.unfanned ?? 0, oldestUnfannedMinutes: hooks?.oldest ?? 0, pendingDeliveries: pendingRows[0]?.n ?? 0 },
    sms: { sent1h: sms?.sent ?? 0, failed1h: sms?.failed ?? 0 },
    errors: { last15m: errs?.recent ?? 0, open: errs?.open ?? 0 },
    cron: await listCronJobStatus(now),
  };
}

/**
 * The alert rules. Pure: snapshot in, conditions out (tests cover each rule).
 * Cron jobs are only checked once they have run at least once, so a fresh database or a
 * local dev machine without the cron worker doesn't raise false alarms.
 */
export function alertConditions(s: OpsSnapshot, expect: CronExpectations, now: Date): AlertCondition[] {
  const out: AlertCondition[] = [];
  if (s.outbox.stuck > 0) {
    out.push({ key: "outbox_stuck", severity: "critical", title: `${s.outbox.stuck} order event(s) gave up after ${OUTBOX_MAX_ATTEMPTS} tries`, detail: "Buyer SMS/email for those orders may not have gone out. Check domain_events.last_error." });
  }
  if (s.outbox.oldestPendingMinutes >= 15) {
    out.push({ key: "outbox_backlog", severity: "warning", title: `Order events are ${s.outbox.oldestPendingMinutes} minutes behind`, detail: `${s.outbox.pending} waiting.` });
  }
  if (s.webhooks.oldestUnfannedMinutes >= 15) {
    out.push({ key: "webhook_backlog", severity: "warning", title: `Webhook events are ${s.webhooks.oldestUnfannedMinutes} minutes behind`, detail: `${s.webhooks.unfanned} not yet sent out.` });
  }
  const smsTotal = s.sms.sent1h + s.sms.failed1h;
  if (smsTotal >= 10 && s.sms.failed1h / smsTotal > 0.25) {
    out.push({ key: "sms_failures", severity: "warning", title: `${Math.round((s.sms.failed1h / smsTotal) * 100)}% of SMS failed in the last hour`, detail: `${s.sms.failed1h} of ${smsTotal}. Check Semaphore credits and sender name.` });
  }
  if (s.errors.last15m > 0) {
    out.push({ key: "app_errors", severity: s.errors.last15m >= 5 ? "critical" : "warning", title: `${s.errors.last15m} different server error(s) in the last 15 minutes`, detail: "See System health → Errors." });
  }
  for (const job of s.cron) {
    const limit = expect[job.job];
    if (limit && job.lastRunAt && now.getTime() - job.lastRunAt.getTime() > limit * 60_000) {
      out.push({ key: `cron_missing:${job.job}`.slice(0, 80), severity: "critical", title: `Cron ${job.job} hasn't run for ${Math.round((now.getTime() - job.lastRunAt.getTime()) / 60_000)} minutes`, detail: `Expected at least every ${limit} minutes.` });
    }
    if (job.lastOk === false && job.lastSuccessAt && job.lastRunAt && now.getTime() - job.lastSuccessAt.getTime() > Math.max(30, (limit ?? 10) * 3) * 60_000) {
      out.push({ key: `cron_failing:${job.job}`.slice(0, 80), severity: "critical", title: `Cron ${job.job} has been failing since ${job.lastSuccessAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, detail: job.lastSummary ?? undefined });
    } else if (job.lastOk === false && !job.lastSuccessAt) {
      out.push({ key: `cron_failing:${job.job}`.slice(0, 80), severity: "critical", title: `Cron ${job.job} has never succeeded`, detail: job.lastSummary ?? undefined });
    }
  }
  return out;
}

export interface OpsAlertRow {
  id: string;
  key: string;
  severity: AlertSeverity;
  title: string;
  detail: string | null;
  openedAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  notifiedAt: Date | null;
}

/** Opens new alerts, refreshes ones still true, resolves the rest. Returns what changed. */
export async function syncOpsAlerts(conditions: AlertCondition[], now = new Date()): Promise<{ opened: OpsAlertRow[]; resolved: OpsAlertRow[]; open: OpsAlertRow[] }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const current = await tx.select().from(opsAlerts).where(isNull(opsAlerts.resolvedAt)).for("update");
    const byKey = new Map(current.map((a) => [a.key, a]));
    const wanted = new Map(conditions.map((c) => [c.key, c]));
    const opened: OpsAlertRow[] = [];
    const resolved: OpsAlertRow[] = [];
    for (const c of wanted.values()) {
      const existing = byKey.get(c.key);
      if (existing) {
        await tx
          .update(opsAlerts)
          .set({ lastSeenAt: now, title: c.title, detail: c.detail ?? null, severity: c.severity })
          .where(eq(opsAlerts.id, existing.id));
      } else {
        const [row] = await tx
          .insert(opsAlerts)
          .values({ key: c.key, severity: c.severity, title: c.title, detail: c.detail ?? null, openedAt: now, lastSeenAt: now })
          .returning();
        opened.push(row!);
      }
    }
    for (const a of current) {
      if (!wanted.has(a.key)) {
        const [row] = await tx.update(opsAlerts).set({ resolvedAt: now }).where(eq(opsAlerts.id, a.id)).returning();
        resolved.push(row!);
      }
    }
    const open = await tx.select().from(opsAlerts).where(isNull(opsAlerts.resolvedAt)).orderBy(asc(opsAlerts.openedAt));
    return { opened, resolved, open };
  });
}

export async function markAlertsNotified(ids: string[], now = new Date()): Promise<void> {
  if (ids.length === 0) return;
  await getDb().update(opsAlerts).set({ notifiedAt: now }).where(sql`${opsAlerts.id} in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
}

export async function listOpsAlerts(options: { days?: number } = {}): Promise<{ open: OpsAlertRow[]; recent: OpsAlertRow[] }> {
  const db = getDb();
  const since = new Date(Date.now() - (options.days ?? 7) * 86_400_000);
  const [open, recent] = await Promise.all([
    db.select().from(opsAlerts).where(isNull(opsAlerts.resolvedAt)).orderBy(desc(opsAlerts.openedAt)),
    db
      .select()
      .from(opsAlerts)
      .where(and(gt(opsAlerts.resolvedAt, since)))
      .orderBy(desc(opsAlerts.resolvedAt))
      .limit(30),
  ]);
  return { open, recent };
}
