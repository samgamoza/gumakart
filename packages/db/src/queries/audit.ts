import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import { auditChainChecks, auditEvents } from "../schema/index";

/*
  Security G3 (GK-20): the hash-chained audit log. Rows are written by database
  triggers inside the transaction of the action they record; the app only adds
  events the database can't see on its own (logins, 2FA, support access) and
  runs the daily chain check.
*/

export interface AuditEventInput {
  tenantId?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
}

/** Writes one audit event (same transaction when `tx` is given). Never throws to the caller's flow. */
export async function recordAuditEvent(input: AuditEventInput, tx?: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }): Promise<void> {
  const runner = tx ?? getDb();
  try {
    await runner.execute(
      sql`select audit_event(${input.tenantId ?? null}::uuid, ${input.actorId ?? null}::uuid, ${input.actorLabel ?? null}, ${input.action}, ${input.entityType}, ${input.entityId ?? null}, ${JSON.stringify(input.details ?? {})}::jsonb)`
    );
  } catch (error) {
    console.error("[audit] could not record", input.action, error instanceof Error ? error.message : error);
  }
}

export interface AuditEventRow {
  seq: number;
  id: string;
  tenantId: string | null;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown>;
  createdAt: Date;
  hash: string;
}

export async function listAuditEvents(filter: { tenantId?: string | null; entityType?: string; entityId?: string; limit?: number } = {}): Promise<AuditEventRow[]> {
  const db = getDb();
  const conds = [];
  if (filter.tenantId !== undefined) conds.push(filter.tenantId === null ? sql`${auditEvents.tenantId} is null` : eq(auditEvents.tenantId, filter.tenantId));
  if (filter.entityType) conds.push(eq(auditEvents.entityType, filter.entityType));
  if (filter.entityId) conds.push(eq(auditEvents.entityId, filter.entityId));
  const rows = await db
    .select()
    .from(auditEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditEvents.seq))
    .limit(Math.min(Math.max(filter.limit ?? 50, 1), 500));
  return rows.map((r) => ({ seq: r.seq, id: r.id, tenantId: r.tenantId, actorId: r.actorId, actorLabel: r.actorLabel, action: r.action, entityType: r.entityType, entityId: r.entityId, details: r.details, createdAt: r.createdAt, hash: r.hash }));
}

export interface ChainCheckResult {
  tenantId: string | null;
  ok: boolean;
  checked: number;
  problem: string | null;
  lastSeq: number | null;
  lastHash: string | null;
}

/** Verifies one chain without recording anything. */
export async function verifyAuditChain(tenantId: string | null): Promise<ChainCheckResult> {
  const db = getDb();
  const rows = (await db.execute(sql`select * from audit_chain_verify(${tenantId}::uuid)`)) as unknown as Array<{ ok: boolean; checked: string; problem: string | null; last_seq: string | null; last_hash: string | null }>;
  const r = rows[0];
  return { tenantId, ok: Boolean(r?.ok), checked: Number(r?.checked ?? 0), problem: r?.problem ?? null, lastSeq: r?.last_seq === null || r?.last_seq === undefined ? null : Number(r.last_seq), lastHash: r?.last_hash ?? null };
}

/** The daily check: every chain, compared with its previously recorded head; results stored in audit_chain_checks. */
export async function runAuditChainCheck(): Promise<ChainCheckResult[]> {
  const db = getDb();
  const rows = (await db.execute(sql`select * from run_audit_chain_check()`)) as unknown as Array<{ tenant_id: string | null; ok: boolean; checked: string; problem: string | null; last_seq: string | null; last_hash: string | null }>;
  return rows.map((r) => ({ tenantId: r.tenant_id, ok: Boolean(r.ok), checked: Number(r.checked), problem: r.problem, lastSeq: r.last_seq === null ? null : Number(r.last_seq), lastHash: r.last_hash }));
}

export async function latestChainChecks(limit = 50) {
  const db = getDb();
  return db.select().from(auditChainChecks).orderBy(desc(auditChainChecks.id)).limit(limit);
}

/**
 * Security G3: scheduled jobs never overlap. Runs `fn` only if this process now
 * holds the named lock (TTL guards against a run that died mid-way). Returns
 * null when another run holds it.
 */
export async function withCronLock<T>(name: string, fn: () => Promise<T>, ttlSeconds = 900): Promise<T | null> {
  const db = getDb();
  const holder = `${process.env.CF_RAY ?? ""}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 64);
  const got = (await db.execute(sql`select try_cron_lock(${name}, ${holder}, ${ttlSeconds}) as got`)) as unknown as Array<{ got: boolean }>;
  if (!got[0]?.got) return null;
  try {
    return await fn();
  } finally {
    await db.execute(sql`select release_cron_lock(${name}, ${holder})`).catch(() => undefined);
  }
}
