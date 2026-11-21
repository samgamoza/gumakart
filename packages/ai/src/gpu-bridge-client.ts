/**
 * Client for the GPU bridge realtime endpoint (decision D1). Runs on Cloudflare Workers
 * (fetch + Web Crypto only) and in Node.
 *
 *   runLocalFirst(): try Qwen3 on the home GPU node via the bridge; on 530 (tunnel down), 502–504,
 *   timeout or a network error, fall back to the cloud model — the seller never sees an error
 *   because the workstation is asleep.
 *
 * Env: GPU_BRIDGE_URL (e.g. https://bridge.guma.one), GPU_BRIDGE_SECRET (same as the bridge),
 *      GPU_BRIDGE_TIMEOUT_MS (default 20000), optional GPU_BRIDGE_CF_ACCESS_CLIENT_ID / _SECRET.
 */
export interface GpuBridgeConfig {
  url: string;
  secret: string;
  timeoutMs: number;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  fetch?: typeof fetch;
}

export type BridgePurpose = "copywriter" | "dm_closer" | "cart_nudge" | "broadcast_copy" | "other";

export interface BridgeChatRequest {
  tenantId: string;
  purpose: BridgePurpose;
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; name?: string; tool_call_id?: string; tool_calls?: Array<Record<string, unknown>> }>;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: { type: "json_object" | "text" };
  tools?: unknown[];
}

export interface BridgeChatResult {
  content: string;
  model: string;
  toolCalls: unknown[];
  usage: { promptTokens: number; completionTokens: number };
  finishReason: string | null;
}

/** The node or tunnel is down / slow — fall back. */
export class BridgeUnavailableError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = "BridgeUnavailableError";
  }
}

/** The bridge answered but refused (bad signature, bad request, rate limit) — also falls back, logged loudly. */
export class BridgeRejectedError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "BridgeRejectedError";
  }
}

type Env = Record<string, string | undefined>;
const processEnv = (): Env => (typeof process !== "undefined" && process.env ? (process.env as Env) : {});

export function bridgeConfigFromEnv(env: Env = processEnv()): GpuBridgeConfig | null {
  const url = env.GPU_BRIDGE_URL?.trim();
  const secret = env.GPU_BRIDGE_SECRET?.trim();
  if (!url || !secret) return null;
  return {
    url: url.replace(/\/+$/, ""),
    secret,
    timeoutMs: Number(env.GPU_BRIDGE_TIMEOUT_MS) > 0 ? Number(env.GPU_BRIDGE_TIMEOUT_MS) : 20_000,
    cfAccessClientId: env.GPU_BRIDGE_CF_ACCESS_CLIENT_ID || undefined,
    cfAccessClientSecret: env.GPU_BRIDGE_CF_ACCESS_CLIENT_SECRET || undefined,
  };
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Same scheme the bridge verifies: v1=hex(HMAC-SHA256(secret, `${ts}.${body}`)). */
export async function signBridgeRequest(secret: string, body: string, nowSec = Math.floor(Date.now() / 1000)): Promise<Record<string, string>> {
  return { "x-guma-timestamp": String(nowSec), "x-guma-signature": `v1=${await hmacSha256Hex(secret, `${nowSec}.${body}`)}` };
}

const UNAVAILABLE = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

export async function callBridgeChat(cfg: GpuBridgeConfig, req: BridgeChatRequest): Promise<BridgeChatResult> {
  const body = JSON.stringify({
    kind: "chat",
    tenantId: req.tenantId,
    purpose: req.purpose,
    request: {
      messages: req.messages,
      ...(req.maxTokens ? { maxTokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.responseFormat ? { responseFormat: req.responseFormat } : {}),
      ...(req.tools ? { tools: req.tools } : {}),
    },
  });
  const headers: Record<string, string> = { "content-type": "application/json", ...(await signBridgeRequest(cfg.secret, body)) };
  if (cfg.cfAccessClientId && cfg.cfAccessClientSecret) {
    headers["CF-Access-Client-Id"] = cfg.cfAccessClientId;
    headers["CF-Access-Client-Secret"] = cfg.cfAccessClientSecret;
  }
  let res: Response;
  try {
    res = await (cfg.fetch ?? fetch)(`${cfg.url}/v1/realtime/chat`, { method: "POST", headers, body, signal: AbortSignal.timeout(cfg.timeoutMs) });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new BridgeUnavailableError(name === "TimeoutError" || name === "AbortError" ? `bridge timed out after ${cfg.timeoutMs} ms` : `bridge unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // Cloudflare error pages (530 etc.) are HTML
  }
  const code = typeof json.code === "string" ? json.code : undefined;
  if (UNAVAILABLE.has(res.status)) throw new BridgeUnavailableError(`bridge returned ${res.status}${code ? ` ${code}` : ""}`, res.status, code);
  if (!res.ok || json.ok !== true) throw new BridgeRejectedError(`bridge refused the request (${res.status}${code ? ` ${code}` : ""})`, res.status, code);
  return {
    content: String(json.content ?? ""),
    model: String(json.model ?? "qwen3"),
    toolCalls: Array.isArray(json.toolCalls) ? json.toolCalls : [],
    usage: {
      promptTokens: Number((json.usage as { promptTokens?: number } | undefined)?.promptTokens ?? 0),
      completionTokens: Number((json.usage as { completionTokens?: number } | undefined)?.completionTokens ?? 0),
    },
    finishReason: typeof json.finishReason === "string" ? json.finishReason : null,
  };
}

export interface LocalFirstResult<T> {
  result: T;
  servedBy: "gpu-node" | "cloud";
  /** Why the GPU node wasn't used (not configured / unavailable / rejected / unusable answer). */
  fallbackReason?: string;
}

/**
 * Try the GPU node, else the cloud. `fromBridge` may return null to reject an unusable answer
 * (e.g. JSON that doesn't parse), which also falls back.
 */
export async function runLocalFirst<T>(opts: {
  bridge: GpuBridgeConfig | null;
  request: BridgeChatRequest;
  fromBridge: (r: BridgeChatResult) => T | null;
  cloud: () => Promise<T>;
  onFallback?: (reason: string, error?: unknown) => void;
}): Promise<LocalFirstResult<T>> {
  const fallback = async (reason: string, error?: unknown): Promise<LocalFirstResult<T>> => {
    opts.onFallback?.(reason, error);
    return { result: await opts.cloud(), servedBy: "cloud", fallbackReason: reason };
  };
  if (!opts.bridge) return fallback("not_configured");
  try {
    const r = await callBridgeChat(opts.bridge, opts.request);
    const mapped = opts.fromBridge(r);
    if (mapped === null) return fallback("unusable_answer");
    return { result: mapped, servedBy: "gpu-node" };
  } catch (error) {
    if (error instanceof BridgeUnavailableError) return fallback("unavailable", error);
    if (error instanceof BridgeRejectedError) return fallback(`rejected_${error.status}`, error);
    return fallback("error", error);
  }
}
