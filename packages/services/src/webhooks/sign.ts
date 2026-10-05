/**
 * Phase 15 — webhook signatures and sending. WebCrypto only (Workers and Node 18+).
 *
 * Header: `Guma-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`.
 * Receivers recompute the HMAC with their endpoint secret, compare in constant time and
 * reject timestamps older than 5 minutes (replay protection).
 */

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signWebhookPayload(secret: string, body: string, timestampSec: number): Promise<string> {
  return `t=${timestampSec},v1=${await hmacHex(secret, `${timestampSec}.${body}`)}`;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string | null | undefined,
  options: { toleranceSec?: number; nowSec?: number } = {}
): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  ) as Record<string, string>;
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  const now = options.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (options.toleranceSec ?? 300)) return false;
  return safeEqual(await hmacHex(secret, `${t}.${body}`), parts.v1);
}

export interface WebhookSendInput {
  url: string;
  secret: string;
  body: string;
  event: string;
  eventId: string;
  deliveryId: string;
  attempt: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface WebhookSendResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  ms: number;
}

/** One POST. 2xx = delivered. Redirects are not followed (a 3xx counts as a failure). */
export async function sendWebhook(input: WebhookSendInput): Promise<WebhookSendResult> {
  const started = Date.now();
  const timestamp = Math.floor(started / 1000);
  const doFetch = input.fetchImpl ?? fetch;
  try {
    const res = await doFetch(input.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "GumaKart-Webhooks/1.0",
        "Guma-Event": input.event,
        "Guma-Event-Id": input.eventId,
        "Guma-Delivery": input.deliveryId,
        "Guma-Attempt": String(input.attempt),
        "Guma-Signature": await signWebhookPayload(input.secret, input.body, timestamp),
      },
      body: input.body,
    });
    const ms = Date.now() - started;
    if (res.status >= 200 && res.status < 300) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: true, statusCode: res.status, error: null, ms };
    }
    let snippet = "";
    try {
      snippet = (await res.text()).replace(/\s+/g, " ").trim().slice(0, 200);
    } catch {
      /* ignore */
    }
    const reason = res.status >= 300 && res.status < 400 ? "Redirects aren't followed — use the final URL." : snippet;
    return { ok: false, statusCode: res.status, error: `HTTP ${res.status}${reason ? `: ${reason}` : ""}`, ms };
  } catch (error) {
    const ms = Date.now() - started;
    const name = error instanceof Error ? error.name : "";
    const message = name === "TimeoutError" || name === "AbortError" ? `No answer within ${Math.round((input.timeoutMs ?? 10_000) / 1000)} seconds.` : `Couldn't connect: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, statusCode: null, error: message.slice(0, 300), ms };
  }
}
