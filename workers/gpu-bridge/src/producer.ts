import { Queue, QueueEvents, type ConnectionOptions } from "bullmq";
import type { ChatResponse } from "./llm-client";
import { QUEUE_REALTIME, realtimeJobOptions, realtimeJobSchema, type RealtimeJobData } from "./queues";

/**
 * For Node producers that CAN reach Redis (e.g. a Phase 3 webhook relay running next to the
 * bridge). Cloudflare-hosted apps enqueue media jobs through Postgres instead (enqueueAiMediaJob).
 */
export class RealtimeProducer {
  private readonly queue: Queue<RealtimeJobData, ChatResponse>;
  private readonly events: QueueEvents;

  constructor(connection: ConnectionOptions) {
    this.queue = new Queue<RealtimeJobData, ChatResponse>(QUEUE_REALTIME, { connection });
    this.events = new QueueEvents(QUEUE_REALTIME, { connection });
  }

  /** Enqueue and wait. Rejects with a message starting "GPU_NODE_UNAVAILABLE" when the node is down. */
  async chat(data: RealtimeJobData, waitMs = 60_000): Promise<ChatResponse> {
    const job = await this.queue.add("chat", realtimeJobSchema.parse(data), realtimeJobOptions());
    return (await job.waitUntilFinished(this.events, waitMs)) as ChatResponse;
  }

  async close(): Promise<void> {
    await Promise.all([this.events.close(), this.queue.close()]);
  }
}
