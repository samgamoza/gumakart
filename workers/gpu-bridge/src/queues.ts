import { z } from "zod";
import type { JobsOptions } from "bullmq";

/** Queue names shared by producers and the worker. */
export const QUEUE_REALTIME = "gpu-realtime";
export const QUEUE_BATCH_MEDIA = "gpu-batch-media";

const chatMessage = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().max(40_000),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  /** Phase 3: an assistant turn that called tools (OpenAI format), replayed to the model. */
  tool_calls: z.array(z.record(z.unknown())).max(10).optional(),
});

/** gpu-realtime: short LLM calls (Taglish copywriting, DM closer replies). */
export const realtimeJobSchema = z.object({
  kind: z.literal("chat"),
  tenantId: z.string().uuid(),
  purpose: z.enum(["copywriter", "dm_closer", "cart_nudge", "broadcast_copy", "other"]),
  request: z.object({
    messages: z.array(chatMessage).min(1).max(60),
    model: z.string().optional(),
    maxTokens: z.number().int().min(1).max(4000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    tools: z.array(z.unknown()).optional(),
    responseFormat: z.object({ type: z.enum(["json_object", "text"]) }).optional(),
  }),
});
export type RealtimeJobData = z.infer<typeof realtimeJobSchema>;

/**
 * gpu-batch-media: one ai_media_jobs row. Only the id travels through Redis — the DB row
 * (input_payload, tenant, credits) stays the source of truth.
 */
export const batchJobSchema = z.object({
  aiMediaJobId: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobType: z.enum(["product_photo", "video_ad", "voice_clone", "printair_mockup"]),
  /** Set after ComfyUI accepted the graph, so a retry resumes polling instead of re-rendering. */
  promptId: z.string().optional(),
});
export type BatchJobData = z.infer<typeof batchJobSchema>;

export function realtimeJobOptions(): JobsOptions {
  return {
    attempts: 1, // a late DM reply is worse than a fallback; callers fall back to the cloud model
    removeOnComplete: { age: 3600, count: 2000 },
    removeOnFail: { age: 24 * 3600 },
  };
}

export function batchJobOptions(jobId: string, priority: number, attempts: number): JobsOptions {
  return {
    jobId, // = ai_media_jobs.id → re-dispatching the same row is a no-op in BullMQ
    priority, // 1 = Enterprise Vibe first … 10 = Printair mockups
    attempts,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: 24 * 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  };
}
