import { and, asc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import { domainEvents } from "../schema/index";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Transactional outbox on `domain_events`.
 *
 * Writers insert the event in the SAME transaction as the state change, so an
 * event exists if and only if the change committed. `relayOutbox()` (cron,
 * every minute) hands unpublished rows to a publisher — Inngest, with
 * `id = idempotency_key`, so a row published twice is delivered once.
 */

export const OUTBOX_MAX_ATTEMPTS = 10;
/** Minutes to wait after the Nth failure (last value repeats). */
const BACKOFF_MINUTES = [1, 5, 30, 120];

export interface OutboxEventInput {
  name: string;
  tenantId: string | null;
  idempotencyKey: string;
  data: Record<string, unknown>;
  correlationId?: string | null;
}

export async function insertOutboxEvent(tx: Tx, input: OutboxEventInput): Promise<void> {
  await tx
    .insert(domainEvents)
    .values({
      tenantId: input.tenantId,
      eventName: input.name,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId ?? null,
      payloadJson: {
        name: input.name,
        data: input.data,
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
      },
    })
    .onConflictDoNothing({ target: domainEvents.idempotencyKey });
}

export interface OutboxRow {
  id: string;
  name: string;
  tenantId: string | null;
  idempotencyKey: string;
  data: Record<string, unknown>;
  attempts: number;
  createdAt: Date;
}

export interface RelayResult {
  published: number;
  failed: number;
  gaveUp: number;
}

/**
 * Publishes up to `limit` due events. Rows are claimed with
 * `FOR UPDATE SKIP LOCKED`, so overlapping cron runs never double-send.
 */
export async function relayOutbox(
  publish: (row: OutboxRow) => Promise<void>,
  options: { limit?: number; now?: Date } = {}
): Promise<RelayResult> {
  const db = getDb();
  const now = options.now ?? new Date();
  const result: RelayResult = { published: 0, failed: 0, gaveUp: 0 };

  await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(domainEvents)
      .where(
        and(
          isNull(domainEvents.publishedAt),
          lt(domainEvents.attempts, OUTBOX_MAX_ATTEMPTS),
          or(isNull(domainEvents.nextAttemptAt), lte(domainEvents.nextAttemptAt, now))
        )
      )
      .orderBy(asc(domainEvents.createdAt))
      .limit(options.limit ?? 50)
      .for("update", { skipLocked: true });

    for (const row of due) {
      const payload = (row.payloadJson ?? {}) as { data?: Record<string, unknown> };
      try {
        await publish({
          id: row.id,
          name: row.eventName,
          tenantId: row.tenantId,
          idempotencyKey: row.idempotencyKey,
          data: payload.data ?? {},
          attempts: row.attempts,
          createdAt: row.createdAt,
        });
        await tx
          .update(domainEvents)
          .set({ publishedAt: new Date(), attempts: row.attempts + 1, lastError: null })
          .where(eq(domainEvents.id, row.id));
        result.published += 1;
      } catch (error) {
        const attempts = row.attempts + 1;
        const waitMinutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]!;
        const gaveUp = attempts >= OUTBOX_MAX_ATTEMPTS;
        await tx
          .update(domainEvents)
          .set({
            attempts,
            lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
            nextAttemptAt: gaveUp ? null : new Date(now.getTime() + waitMinutes * 60_000),
          })
          .where(eq(domainEvents.id, row.id));
        if (gaveUp) result.gaveUp += 1;
        else result.failed += 1;
      }
    }
  });

  return result;
}

/** Counts for the ops dashboard / health check. */
export async function outboxBacklog(): Promise<{ pending: number; stuck: number }> {
  const db = getDb();
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${domainEvents.attempts} < ${OUTBOX_MAX_ATTEMPTS})::int`,
      stuck: sql<number>`count(*) filter (where ${domainEvents.attempts} >= ${OUTBOX_MAX_ATTEMPTS})::int`,
    })
    .from(domainEvents)
    .where(isNull(domainEvents.publishedAt));
  return { pending: row?.pending ?? 0, stuck: row?.stuck ?? 0 };
}
