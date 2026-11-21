import { pathToFileURL } from "node:url";
import { Queue, QueueEvents, Worker } from "bullmq";
import { Redis } from "ioredis";
import { closeDb } from "@gumakart/db";
import { CircuitBreaker } from "./circuit-breaker";
import { ComfyClient } from "./comfy-client";
import { gpuNodeHeaders, loadConfig, type BridgeConfig } from "./config";
import { Dispatcher } from "./dispatcher";
import { createHttpServer } from "./http-server";
import { probe } from "./health";
import { LlmClient } from "./llm-client";
import { createLogger, type Logger } from "./logger";
import { createBatchMediaProcessor } from "./processors/batch-media";
import { createRealtimeProcessor } from "./processors/realtime";
import { QUEUE_BATCH_MEDIA, QUEUE_REALTIME, type BatchJobData, type RealtimeJobData } from "./queues";
import type { ChatResponse } from "./llm-client";
import { parseHostList, SourceFetcher } from "./source-media";
import { LocalStorage, S3Storage, type ObjectStorage } from "./storage";
import type { Server } from "node:http";
import path from "node:path";

export function createStorage(cfg: BridgeConfig): ObjectStorage {
  if (cfg.MEDIA_STORAGE_DRIVER === "local") return new LocalStorage(cfg.MEDIA_LOCAL_DIR);
  return new S3Storage({
    endpoint: cfg.MEDIA_S3_ENDPOINT!,
    region: cfg.MEDIA_S3_REGION,
    bucket: cfg.MEDIA_S3_BUCKET!,
    accessKeyId: cfg.MEDIA_S3_ACCESS_KEY_ID!,
    secretAccessKey: cfg.MEDIA_S3_SECRET_ACCESS_KEY!,
    publicBaseUrl: cfg.MEDIA_PUBLIC_BASE_URL!,
  });
}

export interface RunningBridge {
  stop(): Promise<void>;
  /** Port the HTTP endpoint actually bound (BRIDGE_HTTP_PORT=0 picks a free one in tests). */
  httpPort(): number | undefined;
  breakers: { comfy: CircuitBreaker; llm: CircuitBreaker };
  dispatcher: Dispatcher;
}

/** Wire everything up. Exported so the e2e test can run the real bridge in-process. */
export async function startBridge(cfg: BridgeConfig, log: Logger = createLogger({ svc: "gpu-bridge", node: cfg.GPU_NODE_ID })): Promise<RunningBridge> {
  const connection = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
  const headers = gpuNodeHeaders(cfg);

  const onStateChange = (name: string, from: string, to: string, reason: string) =>
    log[to === "open" ? "warn" : "info"]("circuit breaker state change", { breaker: name, from, to, reason });
  const comfyBreaker = new CircuitBreaker({ name: "comfy", failureThreshold: cfg.BREAKER_FAILURE_THRESHOLD, cooldownMs: cfg.BREAKER_COOLDOWN_MS, onStateChange });
  const llmBreaker = new CircuitBreaker({ name: "llm", failureThreshold: cfg.BREAKER_FAILURE_THRESHOLD, cooldownMs: cfg.BREAKER_COOLDOWN_MS, onStateChange });

  const comfy = new ComfyClient({ baseUrl: cfg.COMFY_BASE_URL, headers });
  const llm = new LlmClient({ baseUrl: cfg.LLM_BASE_URL, apiKey: cfg.LLM_API_KEY, defaultModel: cfg.LLM_MODEL, headers });

  const workers: Worker[] = [];
  const timers: NodeJS.Timeout[] = [];
  const batchQueue = new Queue<BatchJobData>(QUEUE_BATCH_MEDIA, { connection });

  if (cfg.ENABLE_REALTIME) {
    workers.push(
      new Worker<RealtimeJobData>(QUEUE_REALTIME, createRealtimeProcessor({ llm, breaker: llmBreaker, log, timeoutMs: cfg.REALTIME_TIMEOUT_MS }), {
        connection,
        concurrency: cfg.REALTIME_CONCURRENCY,
      })
    );
    timers.push(setInterval(() => void probe(llmBreaker, () => llm.ping(), log), cfg.HEALTH_INTERVAL_MS));
  }

  const dispatcher = new Dispatcher({ queue: batchQueue, breaker: comfyBreaker, log, maxAttempts: cfg.BATCH_MAX_ATTEMPTS, stuckJobMs: cfg.STUCK_JOB_MS });

  if (cfg.ENABLE_BATCH) {
    const storage = createStorage(cfg);
    workers.push(
      new Worker<BatchJobData>(
        QUEUE_BATCH_MEDIA,
        createBatchMediaProcessor({
          comfy,
          breaker: comfyBreaker,
          llm,
          llmBreaker,
          fetcher: new SourceFetcher({
            allowedHosts: parseHostList(cfg.MEDIA_SOURCE_HOSTS),
            baseUrl: cfg.MEDIA_SOURCE_BASE_URL,
            maxBytes: cfg.MEDIA_MAX_SOURCE_BYTES,
            allowHttp: cfg.MEDIA_SOURCE_ALLOW_HTTP,
          }),
          storage,
          log,
          gpuNodeId: cfg.GPU_NODE_ID,
          offlineHoldMs: cfg.OFFLINE_HOLD_MS,
          workRoot: path.resolve(cfg.WORK_DIR),
          cfg,
        }),
        { connection, concurrency: cfg.BATCH_CONCURRENCY, lockDuration: 5 * 60_000 }
      )
    );

    let dispatching = false;
    timers.push(
      setInterval(() => {
        if (dispatching) return;
        dispatching = true;
        dispatcher
          .tick()
          .catch((error) => log.error("dispatcher tick failed", { error }))
          .finally(() => (dispatching = false));
      }, cfg.DISPATCH_INTERVAL_MS)
    );
    timers.push(setInterval(() => void probe(comfyBreaker, () => comfy.ping(), log), cfg.HEALTH_INTERVAL_MS));
  }

  let http: Server | undefined;
  let httpEvents: QueueEvents | undefined;
  let httpQueue: Queue<RealtimeJobData, ChatResponse> | undefined;
  if (cfg.ENABLE_HTTP) {
    httpQueue = new Queue<RealtimeJobData, ChatResponse>(QUEUE_REALTIME, { connection });
    httpEvents = new QueueEvents(QUEUE_REALTIME, { connection: connection.duplicate() });
    http = createHttpServer({
      secret: cfg.GPU_BRIDGE_SECRET!,
      queue: httpQueue,
      events: httpEvents,
      breakers: { llm: llmBreaker, comfy: comfyBreaker },
      waitMs: cfg.HTTP_REALTIME_WAIT_MS,
      log,
    });
    await new Promise<void>((resolve) => http!.listen(cfg.BRIDGE_HTTP_PORT, cfg.BRIDGE_HTTP_HOST, resolve));
    log.info("realtime HTTP endpoint listening", { host: cfg.BRIDGE_HTTP_HOST, port: cfg.BRIDGE_HTTP_PORT });
  }

  for (const w of workers) {
    w.on("error", (error) => log.error("worker error", { queue: w.name, error }));
  }
  log.info("gpu-bridge started", {
    realtime: cfg.ENABLE_REALTIME,
    batch: cfg.ENABLE_BATCH,
    comfy: cfg.COMFY_BASE_URL,
    llm: cfg.LLM_BASE_URL,
    storage: cfg.MEDIA_STORAGE_DRIVER,
    http: cfg.ENABLE_HTTP,
  });

  return {
    breakers: { comfy: comfyBreaker, llm: llmBreaker },
    dispatcher,
    httpPort: () => {
      const addr = http?.address();
      return addr && typeof addr === "object" ? addr.port : undefined;
    },
    async stop() {
      for (const t of timers) clearInterval(t);
      if (http) await new Promise<void>((resolve) => http!.close(() => resolve()));
      await httpEvents?.close();
      await httpQueue?.close();
      await Promise.all(workers.map((w) => w.close()));
      await batchQueue.close();
      await connection.quit().catch(() => connection.disconnect());
    },
  };
}

async function main() {
  const cfg = loadConfig();
  const log = createLogger({ svc: "gpu-bridge", node: cfg.GPU_NODE_ID });
  const bridge = await startBridge(cfg, log);
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    // Active renders finish (or are re-delivered by BullMQ to the next worker run).
    await bridge.stop();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

// pathToFileURL handles Windows drive letters and spaces ("D:\\All Apps\\gumakart\\…").
const isEntry = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main().catch((error) => {
    createLogger({ svc: "gpu-bridge" }).error("fatal", { error });
    process.exit(1);
  });
}
