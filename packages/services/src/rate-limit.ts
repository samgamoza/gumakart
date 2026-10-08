/**
 * Fixed-window rate limiter for public endpoints.
 *
 * Order of preference (GK-2):
 *   1. Upstash Redis (REST) when UPSTASH_REDIS_REST_URL / _TOKEN are set,
 *   2. a shared backend registered by the app (the database counter in
 *      @gumakart/db — one atomic UPSERT per hit, shared by every Worker isolate),
 *   3. a per-instance in-memory window (dev only; on Workers every isolate
 *      would count separately, which is what let limits be dodged).
 */

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * A shared counter: returns the hit count in the current window (after adding
 * this hit when `consume` is true) and the seconds left in the window.
 */
export type SharedRateLimitBackend = (
  key: string,
  options: RateLimitOptions,
  consume: boolean
) => Promise<{ count: number; retryAfterSeconds: number }>;

// Kept on globalThis (like the db client): Next bundles this module separately for the
// instrumentation file and for each route, so a module-level variable would not be shared.
declare global {
  // eslint-disable-next-line no-var
  var __gumaKartRateLimitBackend: SharedRateLimitBackend | null | undefined;
}

/** Registered once per server (each app’s instrumentation.ts) so limits hold across Worker isolates without Redis. */
export function registerSharedRateLimitBackend(backend: SharedRateLimitBackend | null): void {
  globalThis.__gumaKartRateLimitBackend = backend;
}

function sharedBackendNow(): SharedRateLimitBackend | null {
  return globalThis.__gumaKartRateLimitBackend ?? null;
}

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

function memoryRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();

  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (memoryBuckets.size > 10_000) {
    for (const [k, bucket] of memoryBuckets) {
      if (bucket.resetAt <= now) memoryBuckets.delete(k);
    }
  }

  const existing = memoryBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + options.windowSeconds * 1000 });
    return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
  if (existing.count > options.limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return { allowed: true, remaining: options.limit - existing.count, retryAfterSeconds: 0 };
}

async function upstashRateLimit(
  url: string,
  token: string,
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", redisKey],
      // NX: only set the TTL when the key has none (first hit in the window).
      ["EXPIRE", redisKey, String(options.windowSeconds), "NX"],
      ["TTL", redisKey],
    ]),
    signal: AbortSignal.timeout(2000),
  });

  if (!res.ok) {
    throw new Error(`Upstash rate limit request failed (${res.status})`);
  }

  const results = (await res.json()) as Array<{ result: unknown }>;
  const count = Number(results[0]?.result ?? 0);
  const ttl = Number(results[2]?.result ?? options.windowSeconds);
  const retryAfterSeconds = ttl > 0 ? ttl : options.windowSeconds;

  if (count > options.limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return { allowed: true, remaining: options.limit - count, retryAfterSeconds: 0 };
}

/**
 * Checks (and consumes) one request against the limit for `key`.
 * Fails open: an unreachable Redis never blocks real traffic.
 */
export async function rateLimit(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    try {
      return await upstashRateLimit(url, token, key, options);
    } catch (error) {
      console.error("[rate-limit] Upstash unavailable, falling back:", error);
    }
  }
  const sharedBackend = sharedBackendNow();
  if (sharedBackend) {
    try {
      const { count, retryAfterSeconds } = await sharedBackend(key, options, true);
      if (count > options.limit) return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
      return { allowed: true, remaining: options.limit - count, retryAfterSeconds: 0 };
    } catch (error) {
      console.error("[rate-limit] shared counter unavailable, falling back to memory:", error);
    }
  }
  return memoryRateLimit(key, options);
}

/**
 * Is `key` already over its limit? Reads without spending a hit, so a lockout can
 * be charged only on failures: check first, then `rateLimit()` the same key when
 * the attempt fails.
 */
export async function rateLimitBlocked(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  const sharedBackend = sharedBackendNow();
  if (sharedBackend) {
    try {
      const { count, retryAfterSeconds } = await sharedBackend(key, options, false);
      if (count >= options.limit) return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
      return { allowed: true, remaining: options.limit - count, retryAfterSeconds: 0 };
    } catch (error) {
      console.error("[rate-limit] shared counter unavailable, falling back to memory:", error);
    }
  }
  const bucket = memoryBuckets.get(key);
  const now = Date.now();
  if (!bucket || bucket.resetAt <= now) return { allowed: true, remaining: options.limit, retryAfterSeconds: 0 };
  if (bucket.count >= options.limit) return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  return { allowed: true, remaining: options.limit - bucket.count, retryAfterSeconds: 0 };
}

/**
 * Client IP for rate-limit keys. Cloudflare sets `cf-connecting-ip` itself and
 * overwrites anything the client sent, so it is trusted first; `x-forwarded-for`
 * is only a fallback off Cloudflare (Vercel rewrites it too). A client-supplied
 * header can therefore no longer give each request a fresh identity (GK-2).
 */
export function clientIpFrom(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

/** A stable, non-reversible key part for an email or phone (never store the raw value in a limiter key). */
export async function limiterSubject(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Standard 429 JSON body + headers for a blocked request. */
export function rateLimitResponseInit(result: RateLimitResult): ResponseInit {
  return {
    status: 429,
    headers: {
      "Retry-After": String(Math.max(result.retryAfterSeconds, 1)),
      "Content-Type": "application/json",
    },
  };
}
