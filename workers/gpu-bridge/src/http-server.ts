import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Queue, QueueEvents } from "bullmq";
import type { CircuitBreaker } from "./circuit-breaker";
import type { ChatResponse } from "./llm-client";
import type { Logger } from "./logger";
import { realtimeJobOptions, realtimeJobSchema, type RealtimeJobData } from "./queues";

/**
 * Realtime HTTP endpoint (decision D1), published through the Cloudflare Tunnel:
 *   GET  /healthz            → breaker states (no auth, no secrets)
 *   POST /v1/realtime/chat   → HMAC-signed; enqueues on gpu-realtime and waits for the answer
 *
 * Signature: x-guma-timestamp: <unix seconds>
 *            x-guma-signature: v1=<hex HMAC-SHA256(GPU_BRIDGE_SECRET, `${timestamp}.${rawBody}`)>
 * Requests older/newer than 5 minutes are rejected.
 */
export const SIGNATURE_WINDOW_SEC = 300;
const MAX_BODY_BYTES = 256 * 1024;

export function signBody(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function verifySignature(secret: string, timestampHeader: string | undefined, signatureHeader: string | undefined, body: string, nowSec = Math.floor(Date.now() / 1000)): "ok" | "missing" | "stale" | "bad" {
  if (!timestampHeader || !signatureHeader) return "missing";
  const ts = Number(timestampHeader);
  if (!Number.isInteger(ts) || Math.abs(nowSec - ts) > SIGNATURE_WINDOW_SEC) return "stale";
  const expected = Buffer.from(signBody(secret, ts, body));
  const given = Buffer.from(signatureHeader.trim());
  if (expected.length !== given.length) return "bad";
  return timingSafeEqual(expected, given) ? "ok" : "bad";
}

/** Fixed-window limiter per shop — protects the single GPU from one noisy tenant. */
export class TenantRateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly perMinute: number, private readonly now: () => number = Date.now) {}
  allow(tenantId: string): boolean {
    const t = this.now();
    const w = this.windows.get(tenantId);
    if (!w || t - w.start >= 60_000) {
      this.windows.set(tenantId, { start: t, count: 1 });
      if (this.windows.size > 5000) this.windows.clear();
      return true;
    }
    w.count += 1;
    return w.count <= this.perMinute;
  }
}

export interface HttpServerDeps {
  secret: string;
  queue: Pick<Queue<RealtimeJobData, ChatResponse>, "add">;
  events: QueueEvents;
  breakers: { llm: CircuitBreaker; comfy: CircuitBreaker };
  waitMs: number;
  log: Logger;
  perTenantPerMinute?: number;
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) tooBig = true; // keep draining so the client gets a clean 413
      else chunks.push(c);
      if (size > MAX_BODY_BYTES * 8) req.destroy(); // hard stop for abusive senders
    });
    req.on("end", () => resolve(tooBig ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createHttpServer(deps: HttpServerDeps): Server {
  const limiter = new TenantRateLimiter(deps.perTenantPerMinute ?? 120);
  return createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://bridge");
    try {
      if (req.method === "GET" && url.pathname === "/healthz") {
        return send(res, 200, { ok: true, llm: deps.breakers.llm.currentState, comfy: deps.breakers.comfy.currentState });
      }
      if (url.pathname !== "/v1/realtime/chat") return send(res, 404, { ok: false, error: "not found" });
      if (req.method !== "POST") return send(res, 405, { ok: false, error: "method not allowed" });

      const body = await readBody(req);
      if (body === null) return send(res, 413, { ok: false, error: "body too large" });
      const sig = verifySignature(deps.secret, header(req, "x-guma-timestamp"), header(req, "x-guma-signature"), body);
      if (sig !== "ok") {
        deps.log.warn("rejected unsigned/invalid realtime request", { reason: sig, ip: header(req, "cf-connecting-ip") ?? req.socket.remoteAddress });
        return send(res, 401, { ok: false, error: "invalid signature" });
      }

      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        return send(res, 400, { ok: false, error: "invalid JSON" });
      }
      const parsed = realtimeJobSchema.safeParse(json);
      if (!parsed.success) return send(res, 400, { ok: false, error: parsed.error.issues[0]?.message ?? "invalid request" });
      if (!limiter.allow(parsed.data.tenantId)) return send(res, 429, { ok: false, code: "RATE_LIMITED", error: "too many requests for this shop" });

      // Don't queue behind a dead node: let the caller fall back to the cloud right away.
      if (deps.breakers.llm.currentState === "open") {
        return send(res, 503, { ok: false, code: "GPU_NODE_UNAVAILABLE", retryInMs: deps.breakers.llm.retryInMs });
      }

      const job = await deps.queue.add("chat", parsed.data, realtimeJobOptions());
      try {
        const result = (await job.waitUntilFinished(deps.events, deps.waitMs)) as ChatResponse;
        deps.log.info("realtime served", { tenantId: parsed.data.tenantId, purpose: parsed.data.purpose, ms: Date.now() - started });
        return send(res, 200, { ok: true, servedBy: "gpu-node", ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/GPU_NODE_UNAVAILABLE/.test(message)) return send(res, 503, { ok: false, code: "GPU_NODE_UNAVAILABLE" });
        if (/timed out|timeout/i.test(message)) return send(res, 504, { ok: false, code: "TIMEOUT" });
        deps.log.error("realtime job failed", { error: message });
        return send(res, 502, { ok: false, code: "UPSTREAM_ERROR" });
      }
    } catch (error) {
      deps.log.error("http handler error", { error });
      if (!res.headersSent) send(res, 500, { ok: false, error: "internal error" });
    }
  });
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
