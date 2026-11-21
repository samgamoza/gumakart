import { rm } from "node:fs/promises";
import path from "node:path";
import { DelayedError, UnrecoverableError, type Job } from "bullmq";
import { ZodError } from "zod";
import {
  claimAiMediaJob,
  completeAiMediaJob,
  failAiMediaJob,
  releaseAiMediaJob,
  touchAiMediaJob,
  type AiMediaOutput,
} from "@gumakart/db";
import { CircuitBreaker, GpuNodeUnavailableError, isNodeFailure } from "../circuit-breaker";
import { ComfyClient, ComfyExecutionError, mediaKind } from "../comfy-client";
import type { LlmClient } from "../llm-client";
import type { Logger } from "../logger";
import { customGraphPipeline } from "../pipelines/custom-graph";
import { printairMockupPipeline } from "../pipelines/printair-mockup";
import { productPhotoPipeline } from "../pipelines/product-photo";
import type { Pipeline, PipelineConfig } from "../pipelines/types";
import { videoAdPipeline } from "../pipelines/video-ad";
import { voiceClonePipeline } from "../pipelines/voice-clone";
import { batchJobSchema, type BatchJobData } from "../queues";
import { SourceMediaError, type SourceFetcher } from "../source-media";
import { mediaObjectKey, type ObjectStorage } from "../storage";
import { WorkflowInputError } from "../workflows";

export interface BatchMediaDeps {
  comfy: ComfyClient;
  breaker: CircuitBreaker;
  llm: LlmClient;
  llmBreaker: CircuitBreaker;
  fetcher: SourceFetcher;
  storage: ObjectStorage;
  log: Logger;
  gpuNodeId: string;
  offlineHoldMs: number;
  workRoot: string;
  cfg: PipelineConfig;
  /** Override per job type (tests). */
  pipelines?: Partial<Record<BatchJobData["jobType"], Pipeline>>;
}

export type BatchMediaResult = { status: "completed"; outputs: number } | { status: "skipped"; reason: string };

const PIPELINES: Partial<Record<BatchJobData["jobType"], Pipeline>> = {
  product_photo: productPhotoPipeline,
  video_ad: videoAdPipeline,
  voice_clone: voiceClonePipeline,
  printair_mockup: printairMockupPipeline,
};

/** Errors that won't get better on retry: fail now and refund. */
function isPermanent(error: unknown): boolean {
  return (
    error instanceof WorkflowInputError ||
    error instanceof ComfyExecutionError ||
    error instanceof SourceMediaError ||
    error instanceof ZodError
  );
}

/**
 * gpu-batch-media processor:
 *   claim row → pipeline (product_photo / video_ad / voice_clone, or a raw graph) → upload outputs
 *   → mark completed (credit consumed). Permanent errors fail the row and refund the credit.
 *   GPU node offline → park (BullMQ delayed, row back to `queued`) without using an attempt.
 */
export function createBatchMediaProcessor(deps: BatchMediaDeps) {
  const pipelines = { ...PIPELINES, ...(deps.pipelines ?? {}) };

  return async function processBatchMedia(job: Job<BatchJobData>, token?: string): Promise<BatchMediaResult> {
    const data = batchJobSchema.parse(job.data);
    const log = deps.log.child({ queue: "gpu-batch-media", aiMediaJobId: data.aiMediaJobId, tenantId: data.tenantId, jobType: data.jobType });
    const workDir = path.join(deps.workRoot, data.aiMediaJobId);

    const park = async (reason: string): Promise<never> => {
      await releaseAiMediaJob(data.aiMediaJobId);
      const retryIn = Math.max(deps.breaker.retryInMs, deps.llmBreaker.retryInMs, deps.offlineHoldMs);
      const wakeAt = Date.now() + retryIn;
      log.warn("gpu node unavailable — job parked", { reason, wakeAt: new Date(wakeAt).toISOString() });
      await job.moveToDelayed(wakeAt, token);
      throw new DelayedError();
    };

    if (deps.breaker.currentState === "open") return park("circuit open");

    const row = await claimAiMediaJob(data.aiMediaJobId, deps.gpuNodeId);
    if (!row) return { status: "skipped", reason: "job already finished" };

    const cleanup = () => rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    const failPermanently = async (message: string): Promise<never> => {
      const r = await failAiMediaJob(row.id, message);
      await cleanup();
      log.error("media job failed", { error: message, refunded: r.refunded });
      throw new UnrecoverableError(message);
    };

    try {
      const hasGraph = (row.inputPayload as { workflow?: unknown }).workflow !== undefined;
      const pipeline = hasGraph ? customGraphPipeline : pipelines[row.jobType];
      if (!pipeline) return failPermanently(`${row.jobType} isn't available yet`);

      log.info("media job started", { priority: row.priority, attempt: job.attemptsMade + 1 });
      const produced = await pipeline({
        row,
        comfy: deps.comfy,
        comfyBreaker: deps.breaker,
        llm: deps.llm,
        llmBreaker: deps.llmBreaker,
        fetcher: deps.fetcher,
        cfg: deps.cfg,
        workDir,
        log,
        heartbeat: () => touchAiMediaJob(row.id),
      });
      if (produced.length === 0) return failPermanently("The render finished without producing any files");

      const outputs: AiMediaOutput[] = [];
      for (const [i, file] of produced.entries()) {
        const url = await deps.storage.put(mediaObjectKey(row.tenantId, row.id, i, file.filename), file.bytes, file.contentType);
        outputs.push({ url, kind: mediaKind(file.contentType), contentType: file.contentType, bytes: file.bytes.byteLength, ...(file.variant ? { variant: file.variant } : {}) });
      }
      await completeAiMediaJob(row.id, outputs);
      await cleanup();
      log.info("media job completed", { outputs: outputs.length });
      return { status: "completed", outputs: outputs.length };
    } catch (error) {
      if (error instanceof DelayedError || error instanceof UnrecoverableError) throw error;
      if (error instanceof GpuNodeUnavailableError || isNodeFailure(error)) {
        return park(error instanceof Error ? error.message : String(error));
      }
      if (isPermanent(error)) return failPermanently(error instanceof Error ? error.message : String(error));
      // Anything else (storage upload, ComfyUI timeout, ffmpeg, DB blip): BullMQ retries with backoff.
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const message = error instanceof Error ? error.message : String(error);
      if (lastAttempt) {
        const r = await failAiMediaJob(row.id, message);
        await cleanup();
        log.error("media job failed after final attempt", { error, refunded: r.refunded });
      } else {
        log.warn("media job attempt failed — will retry", { error, attempt: job.attemptsMade + 1 });
      }
      throw error;
    }
  };
}
