import { UnrecoverableError, type Job } from "bullmq";
import { CircuitBreaker, GpuNodeUnavailableError, isNodeFailure } from "../circuit-breaker";
import { LlmClient, type ChatResponse } from "../llm-client";
import type { Logger } from "../logger";
import { realtimeJobSchema, type RealtimeJobData } from "../queues";

export interface RealtimeDeps {
  llm: LlmClient;
  breaker: CircuitBreaker;
  log: Logger;
  timeoutMs: number;
}

/**
 * gpu-realtime processor: one chat completion on the local Qwen3 node.
 * Never parks — when the node is down it fails immediately (UnrecoverableError, code
 * GPU_NODE_UNAVAILABLE) so the caller can fall back to its cloud model instead of making a
 * buyer wait.
 */
export function createRealtimeProcessor(deps: RealtimeDeps) {
  return async function processRealtime(job: Job<RealtimeJobData>): Promise<ChatResponse> {
    const parsed = realtimeJobSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError(`invalid realtime job: ${parsed.error.issues[0]?.message ?? "bad data"}`);
    const data = parsed.data;
    const started = Date.now();
    try {
      const res = await deps.breaker.run(() => deps.llm.chat(data.request, deps.timeoutMs), isNodeFailure);
      deps.log.info("realtime completion", {
        queue: "gpu-realtime",
        tenantId: data.tenantId,
        purpose: data.purpose,
        ms: Date.now() - started,
        promptTokens: res.usage.promptTokens,
        completionTokens: res.usage.completionTokens,
      });
      return res;
    } catch (error) {
      if (error instanceof GpuNodeUnavailableError || isNodeFailure(error)) {
        throw new UnrecoverableError(`GPU_NODE_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`);
      }
      throw new UnrecoverableError(error instanceof Error ? error.message : String(error));
    }
  };
}
