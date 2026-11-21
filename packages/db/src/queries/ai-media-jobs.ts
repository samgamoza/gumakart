import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  creditKindForJob,
  creditsRemaining,
  mediaJobDenial,
  mediaJobPriority,
  type AiMediaJobType,
  type MediaJobDenial,
} from "@gumakart/plans";
import { getDb } from "../client";
import { aiMediaJobs, merchantEntitlements, type AiMediaOutput } from "../schema/index";

/**
 * AI Marketing Suite — GPU media jobs and monthly credit metering (migration 0047).
 *
 * Lifecycle:  enqueue (reserve credit) → dispatcher hands row to BullMQ → worker claims
 *             (processing) → complete (credit consumed) | fail (credit refunded).
 * The ai_media_jobs row is the source of truth. If the home GPU node is offline, rows simply
 * stay `queued` with dispatched_at NULL until the gpu-bridge dispatcher picks them up.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type AiMediaJobRow = typeof aiMediaJobs.$inferSelect;
export type MerchantEntitlementsRow = typeof merchantEntitlements.$inferSelect;

export interface EntitlementSummary extends MerchantEntitlementsRow {
  /** Counters as they apply right now (a new month reads as 0 used before the row rolls over). */
  photoCreditsUsedNow: number;
  videoCreditsUsedNow: number;
  /** null = unlimited */
  photoCreditsRemaining: number | null;
  videoCreditsRemaining: number | null;
}

function currentPeriod(now = new Date()): string {
  // Calendar month in Philippine time (UTC+8, no DST) — same as ai_suite_current_period().
  const ph = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return `${ph.getUTCFullYear()}-${String(ph.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

async function loadEntitlements(db: Db | Tx, tenantId: string): Promise<MerchantEntitlementsRow | null> {
  const [row] = await db
    .select()
    .from(merchantEntitlements)
    .where(eq(merchantEntitlements.tenantId, tenantId))
    .limit(1);
  if (row) return row;
  // Shop created before the trigger existed on this database: build its row now.
  await db.execute(sql`select ai_suite_sync_entitlements(${tenantId}::uuid)`);
  const [synced] = await db
    .select()
    .from(merchantEntitlements)
    .where(eq(merchantEntitlements.tenantId, tenantId))
    .limit(1);
  return synced ?? null;
}

export function summarizeEntitlements(row: MerchantEntitlementsRow, now = new Date()): EntitlementSummary {
  const stale = row.periodStart < currentPeriod(now);
  const photoUsed = stale ? 0 : row.photoCreditsUsed;
  const videoUsed = stale ? 0 : row.videoCreditsUsed;
  return {
    ...row,
    photoCreditsUsedNow: photoUsed,
    videoCreditsUsedNow: videoUsed,
    photoCreditsRemaining: creditsRemaining(row.photoCreditsLimit, photoUsed),
    videoCreditsRemaining: creditsRemaining(row.videoCreditsLimit, videoUsed),
  };
}

export async function getMerchantEntitlements(tenantId: string): Promise<EntitlementSummary | null> {
  const row = await loadEntitlements(getDb(), tenantId);
  return row ? summarizeEntitlements(row) : null;
}

export interface EnqueueAiMediaJobInput {
  tenantId: string;
  jobType: AiMediaJobType;
  productId?: string | null;
  inputPayload: Record<string, unknown>;
  /** Same key twice → the first job is returned and no second credit is taken. */
  idempotencyKey?: string | null;
}

export type EnqueueAiMediaJobResult =
  | { ok: true; job: AiMediaJobRow; duplicate: boolean }
  | { ok: false; reason: MediaJobDenial | "out_of_credits" | "no_entitlements" };

class DuplicateJobRace extends Error {}

export async function enqueueAiMediaJob(input: EnqueueAiMediaJobInput): Promise<EnqueueAiMediaJobResult> {
  const db = getDb();
  const findExisting = async () =>
    input.idempotencyKey
      ? (
          await db
            .select()
            .from(aiMediaJobs)
            .where(and(eq(aiMediaJobs.tenantId, input.tenantId), eq(aiMediaJobs.idempotencyKey, input.idempotencyKey)))
            .limit(1)
        )[0] ?? null
      : null;

  const existing = await findExisting();
  if (existing) return { ok: true, job: existing, duplicate: true };

  try {
    return await db.transaction(async (tx): Promise<EnqueueAiMediaJobResult> => {
      const ent = await loadEntitlements(tx, input.tenantId);
      if (!ent) return { ok: false, reason: "no_entitlements" };

      const denial = mediaJobDenial(ent, input.jobType);
      if (denial) return { ok: false, reason: denial };

      const creditKind = creditKindForJob(input.jobType);
      let creditPeriod: string | null = null;
      if (creditKind) {
        const rows = (await tx.execute(
          sql`select ai_suite_reserve_credit(${input.tenantId}::uuid, ${creditKind})::text as period`
        )) as unknown as Array<{ period: string | null }>;
        creditPeriod = rows[0]?.period ?? null;
        if (!creditPeriod) return { ok: false, reason: "out_of_credits" };
      }

      const [job] = await tx
        .insert(aiMediaJobs)
        .values({
          tenantId: input.tenantId,
          productId: input.productId ?? null,
          jobType: input.jobType,
          priority: mediaJobPriority(ent.queuePriority, input.jobType),
          inputPayload: input.inputPayload,
          creditKind,
          creditStatus: creditKind ? "reserved" : "none",
          creditPeriod,
          idempotencyKey: input.idempotencyKey ?? null,
        })
        .onConflictDoNothing()
        .returning();
      // A concurrent request with the same key won: undo our credit by rolling back.
      if (!job) throw new DuplicateJobRace();
      return { ok: true, job, duplicate: false };
    });
  } catch (error) {
    if (error instanceof DuplicateJobRace) {
      const winner = await findExisting();
      if (winner) return { ok: true, job: winner, duplicate: true };
    }
    throw error;
  }
}

export async function getAiMediaJob(tenantId: string, jobId: string): Promise<AiMediaJobRow | null> {
  const [row] = await getDb()
    .select()
    .from(aiMediaJobs)
    .where(and(eq(aiMediaJobs.tenantId, tenantId), eq(aiMediaJobs.id, jobId)))
    .limit(1);
  return row ?? null;
}

export async function listAiMediaJobs(tenantId: string, limit = 30): Promise<AiMediaJobRow[]> {
  return getDb()
    .select()
    .from(aiMediaJobs)
    .where(eq(aiMediaJobs.tenantId, tenantId))
    .orderBy(desc(aiMediaJobs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

// ─── gpu-bridge worker side (runs without a seller session) ──────────────────

export interface DispatchableJob {
  id: string;
  tenantId: string;
  jobType: AiMediaJobType;
  priority: number;
}

/** Queued jobs not yet handed to BullMQ, best tier first, oldest first. */
export async function listDispatchableAiMediaJobs(limit = 25): Promise<DispatchableJob[]> {
  // tenant-scope: system — the gpu-bridge dispatcher serves every shop.
  const rows = await getDb()
    .select({ id: aiMediaJobs.id, tenantId: aiMediaJobs.tenantId, jobType: aiMediaJobs.jobType, priority: aiMediaJobs.priority })
    .from(aiMediaJobs)
    .where(and(eq(aiMediaJobs.status, "queued"), isNull(aiMediaJobs.dispatchedAt)))
    .orderBy(asc(aiMediaJobs.priority), asc(aiMediaJobs.createdAt))
    .limit(limit);
  return rows;
}

export async function markAiMediaJobsDispatched(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // tenant-scope: system — ids come from listDispatchableAiMediaJobs.
  await getDb()
    .update(aiMediaJobs)
    .set({ dispatchedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(inArray(aiMediaJobs.id, ids), isNull(aiMediaJobs.dispatchedAt)));
}

/** Still-queued jobs that were handed to BullMQ more than `olderThanMs` ago. */
export async function listStaleDispatchedAiMediaJobs(olderThanMs: number, limit = 100): Promise<string[]> {
  // tenant-scope: system — dispatcher recovery sweep.
  const rows = await getDb()
    .select({ id: aiMediaJobs.id })
    .from(aiMediaJobs)
    .where(
      and(
        eq(aiMediaJobs.status, "queued"),
        isNotNull(aiMediaJobs.dispatchedAt),
        lt(aiMediaJobs.dispatchedAt, new Date(Date.now() - olderThanMs))
      )
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Hand jobs back to the DB queue (e.g. Redis lost them); the dispatcher re-sends them. */
export async function resetAiMediaJobDispatch(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // tenant-scope: system — dispatcher recovery sweep.
  await getDb()
    .update(aiMediaJobs)
    .set({ dispatchedAt: null, updatedAt: sql`now()` })
    .where(and(inArray(aiMediaJobs.id, ids), eq(aiMediaJobs.status, "queued")));
}

/**
 * Worker picked the job up. Returns null when the job is already finished (a BullMQ redelivery
 * after completion) so the worker can skip it.
 */
export async function claimAiMediaJob(jobId: string, gpuNodeId: string): Promise<AiMediaJobRow | null> {
  // tenant-scope: system — worker holds the job id from the queue.
  const [row] = await getDb()
    .update(aiMediaJobs)
    .set({
      status: "processing",
      gpuNodeId,
      startedAt: sql`coalesce(${aiMediaJobs.startedAt}, now())`,
      attempts: sql`${aiMediaJobs.attempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(aiMediaJobs.id, jobId), inArray(aiMediaJobs.status, ["queued", "processing"])))
    .returning();
  return row ?? null;
}

/** Idempotent: a second call on a completed job is a no-op. */
export async function completeAiMediaJob(jobId: string, outputs: AiMediaOutput[]): Promise<boolean> {
  // tenant-scope: system — worker holds the job id from the queue.
  const rows = await getDb()
    .update(aiMediaJobs)
    .set({
      status: "completed",
      outputUrls: outputs,
      errorMessage: null,
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
      creditStatus: sql`case when ${aiMediaJobs.creditStatus} = 'reserved' then 'consumed' else ${aiMediaJobs.creditStatus} end`,
    })
    .where(and(eq(aiMediaJobs.id, jobId), inArray(aiMediaJobs.status, ["queued", "processing"])))
    .returning({ id: aiMediaJobs.id });
  return rows.length > 0;
}

/** Idempotent: marks failed and refunds a reserved credit exactly once. */
export async function failAiMediaJob(jobId: string, errorMessage: string): Promise<{ failed: boolean; refunded: boolean }> {
  return getDb().transaction(async (tx) => {
    // tenant-scope: system — worker holds the job id from the queue.
    const [row] = await tx
      .update(aiMediaJobs)
      .set({
        status: "failed",
        errorMessage: errorMessage.slice(0, 2000),
        completedAt: sql`now()`,
        updatedAt: sql`now()`,
        creditStatus: sql`case when ${aiMediaJobs.creditStatus} = 'reserved' then 'refunded' else ${aiMediaJobs.creditStatus} end`,
      })
      .where(and(eq(aiMediaJobs.id, jobId), inArray(aiMediaJobs.status, ["queued", "processing"])))
      .returning({
        tenantId: aiMediaJobs.tenantId,
        creditKind: aiMediaJobs.creditKind,
        creditStatus: aiMediaJobs.creditStatus,
        creditPeriod: aiMediaJobs.creditPeriod,
      });
    if (!row) return { failed: false, refunded: false };
    let refunded = false;
    if (row.creditStatus === "refunded" && row.creditKind && row.creditPeriod) {
      const res = (await tx.execute(
        sql`select ai_suite_refund_credit(${row.tenantId}::uuid, ${row.creditKind}, ${row.creditPeriod}::date) as ok`
      )) as unknown as Array<{ ok: boolean }>;
      refunded = res[0]?.ok === true;
    }
    return { failed: true, refunded };
  });
}

/** Jobs stuck in `processing` (worker died mid-render) — the dispatcher fails/refunds them. */
export async function listStuckProcessingAiMediaJobs(olderThanMs: number, limit = 50): Promise<string[]> {
  // tenant-scope: system — recovery sweep.
  const rows = await getDb()
    .select({ id: aiMediaJobs.id })
    .from(aiMediaJobs)
    .where(and(eq(aiMediaJobs.status, "processing"), lt(aiMediaJobs.updatedAt, new Date(Date.now() - olderThanMs))))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Heartbeat while a long render runs, so it isn't mistaken for stuck. */
export async function touchAiMediaJob(jobId: string): Promise<void> {
  // tenant-scope: system — worker heartbeat.
  await getDb()
    .update(aiMediaJobs)
    .set({ updatedAt: sql`now()` })
    .where(and(eq(aiMediaJobs.id, jobId), eq(aiMediaJobs.status, "processing")));
}

/**
 * GPU node went offline before/while rendering: put the job back to `queued` (it stays parked in
 * BullMQ) so the stuck-job sweep leaves it alone and the seller sees "waiting", not "failed".
 */
export async function releaseAiMediaJob(jobId: string): Promise<void> {
  // tenant-scope: system — worker holds the job id from the queue.
  await getDb()
    .update(aiMediaJobs)
    .set({ status: "queued", updatedAt: sql`now()` })
    .where(and(eq(aiMediaJobs.id, jobId), eq(aiMediaJobs.status, "processing")));
}
