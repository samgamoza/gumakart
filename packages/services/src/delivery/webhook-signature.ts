import { createHmac, timingSafeEqual } from "crypto";

/**
 * Shared HMAC helpers for courier webhooks.
 * When a secret is configured, signatures are required; when unset, callers decide.
 */

export function verifyTimestampedHmacSignature(input: {
  rawBody: string;
  signature: string;
  timestamp: string | number;
  secret: string;
}): boolean {
  const { rawBody, signature, timestamp, secret } = input;
  if (!secret.trim() || !signature || timestamp === undefined || timestamp === "") {
    return false;
  }
  const signed = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signed).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(String(signature));
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Security G2 (GK-19): a signed webhook is only accepted while its timestamp is
 * fresh, so a captured, correctly signed event cannot be replayed later to move
 * a delivery (and the order) forwards or backwards. Accepts seconds or
 * milliseconds since the epoch, or an ISO date.
 */
export function webhookTimestampFresh(timestamp: string | number | undefined, windowMs = 5 * 60_000, now = Date.now()): boolean {
  if (timestamp === undefined || timestamp === null || timestamp === "") return false;
  let t: number;
  if (typeof timestamp === "number" || /^\d+$/.test(String(timestamp))) {
    t = Number(timestamp);
    if (t < 1e12) t *= 1000; // seconds → ms
  } else {
    t = Date.parse(String(timestamp));
  }
  if (!Number.isFinite(t)) return false;
  return Math.abs(now - t) <= windowMs;
}

/**
 * Grab partner webhooks (security G2, GK-19). The signature and timestamp are
 * read from headers first (`X-Grab-Signature`, `X-Grab-Timestamp`); when they
 * ride inside the body instead, the HMAC is computed over the body WITHOUT the
 * `signature` member (the sender cannot have signed its own signature), as
 * `${timestamp}.${json}` where json is the body re-serialised with its keys in
 * the sender's order minus `signature`.
 */
export function verifyGrabWebhook(input: {
  rawBody: string;
  headers: { get(name: string): string | null };
  body: { signature?: string; timestamp?: string | number } & Record<string, unknown>;
  secret: string;
}): { ok: boolean; reason?: string } {
  const headerSig = input.headers.get("x-grab-signature") ?? input.headers.get("x-signature");
  const headerTs = input.headers.get("x-grab-timestamp") ?? input.headers.get("x-timestamp");
  if (headerSig && headerTs) {
    if (!webhookTimestampFresh(headerTs)) return { ok: false, reason: "stale timestamp" };
    const ok = verifyTimestampedHmacSignature({ rawBody: input.rawBody, signature: headerSig, timestamp: headerTs, secret: input.secret });
    return ok ? { ok: true } : { ok: false, reason: "bad header signature" };
  }
  const { signature, ...rest } = input.body;
  const timestamp = input.body.timestamp;
  if (!signature || timestamp === undefined) return { ok: false, reason: "no signature" };
  if (!webhookTimestampFresh(timestamp)) return { ok: false, reason: "stale timestamp" };
  const ok = verifyTimestampedHmacSignature({ rawBody: JSON.stringify(rest), signature: String(signature), timestamp, secret: input.secret });
  return ok ? { ok: true } : { ok: false, reason: "bad body signature" };
}
