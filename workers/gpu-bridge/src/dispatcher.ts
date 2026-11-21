import type { Queue } from "bullmq";
import {
  failAiMediaJob,
  listDispatchableAiMediaJobs,
  listStaleDispatchedAiMediaJobs,
  listStuckProcessingAiMediaJobs,
  markAiMediaJobsDispatched,
  resetAiMediaJobDispatch,
} from "@gumakart/db";
import type { CircuitBreaker } from "./circuit-breaker";
import type { Logger } from "./logger";
import { batchJobOptions, type BatchJobData } from "./queues";

export interface DispatcherDeps {
  queue: Pick<Queue<BatchJobData>, "add" | "getJob">;
  breaker: CircuitBreaker;
  log: Logger;
  maxAttempts: number;
  batchSize?: number;
  stuckJobMs: number;
  /** Re-check dispatched-but-still-queued rows older than this against Redis. */
  staleDispatchMs?: number;
}

/**
 * Outbox relay: ai_media_jobs (Postgres) → gpu-batch-media (BullMQ).
 *
 * Apps on Cloudflare Workers can't open a Redis TCP connection, so they only INSERT the row
 * (enqueueAiMediaJob). This loop hands queued rows to BullMQ in priority order. While the GPU
 * breaker is open it dispatches nothing — jobs wait safely in Postgres ("graceful queue holding").
 * Using the row id as the BullMQ jobId makes every step safe to repeat after a crash.
 */
export class Dispatcher {
  private sweepCounter = 0;
  private holdLogged = false;

  constructor(private readonly deps: DispatcherDeps) {}

  async tick(): Promise<{ dispatched: number; held: boolean }> {
    if (this.deps.breaker.currentState === "open") {
      if (!this.holdLogged) this.deps.log.warn("gpu node offline — holding media jobs in Postgres");
      this.holdLogged = true;
      return { dispatched: 0, held: true };
    }
    if (this.holdLogged) this.deps.log.info("gpu node reachable — dispatching held media jobs");
    this.holdLogged = false;

    const rows = await listDispatchableAiMediaJobs(this.deps.batchSize ?? 25);
    for (const row of rows) {
      await this.deps.queue.add(
        "media",
        { aiMediaJobId: row.id, tenantId: row.tenantId, jobType: row.jobType },
        batchJobOptions(row.id, row.priority, this.deps.maxAttempts)
      );
    }
    await markAiMediaJobsDispatched(rows.map((r) => r.id));
    if (rows.length) this.deps.log.info("dispatched media jobs", { count: rows.length });

    this.sweepCounter += 1;
    if (this.sweepCounter % 20 === 0) await this.sweep();
    return { dispatched: rows.length, held: false };
  }

  /** Recovery: rows Redis lost get re-dispatched; renders whose worker died get failed + refunded. */
  async sweep(): Promise<{ redispatched: number; failedStuck: number }> {
    const stale = await listStaleDispatchedAiMediaJobs(this.deps.staleDispatchMs ?? 10 * 60_000);
    const lost: string[] = [];
    for (const id of stale) {
      if (!(await this.deps.queue.getJob(id))) lost.push(id);
    }
    await resetAiMediaJobDispatch(lost);
    if (lost.length) this.deps.log.warn("re-dispatching jobs missing from Redis", { count: lost.length });

    const stuck = await listStuckProcessingAiMediaJobs(this.deps.stuckJobMs);
    for (const id of stuck) {
      const r = await failAiMediaJob(id, "Render stopped responding (GPU worker restarted). Your credit was refunded.");
      this.deps.log.error("failed stuck media job", { aiMediaJobId: id, refunded: r.refunded });
    }
    return { redispatched: lost.length, failedStuck: stuck.length };
  }
}
