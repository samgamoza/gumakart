import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "../client";
import { consumedTokens, rateLimits } from "../schema/index";

/**
 * Shared fixed-window counter backing @gumakart/services' rateLimit() (GK-2).
 * One atomic UPSERT per hit: when the stored window has expired the row is
 * reset to this hit, otherwise the count is incremented. No read-then-write.
 */
export async function dbRateLimitHit(
  key: string,
  options: { limit: number; windowSeconds: number },
  consume: boolean
): Promise<{ count: number; retryAfterSeconds: number }> {
  const db = getDb();
  const now = new Date();
  const safeKey = key.slice(0, 200);
  if (!consume) {
    const [row] = await db
      .select({ count: rateLimits.count, expiresAt: rateLimits.expiresAt })
      .from(rateLimits)
      .where(eq(rateLimits.key, safeKey))
      .limit(1);
    if (!row || row.expiresAt <= now) return { count: 0, retryAfterSeconds: 0 };
    return { count: row.count, retryAfterSeconds: Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000) };
  }
  const expiresAt = new Date(now.getTime() + options.windowSeconds * 1000);
  const [row] = await db
    .insert(rateLimits)
    .values({ key: safeKey, count: 1, windowStartedAt: now, expiresAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.expiresAt} <= ${now.toISOString()}::timestamptz then 1 else ${rateLimits.count} + 1 end`,
        windowStartedAt: sql`case when ${rateLimits.expiresAt} <= ${now.toISOString()}::timestamptz then ${now.toISOString()}::timestamptz else ${rateLimits.windowStartedAt} end`,
        expiresAt: sql`case when ${rateLimits.expiresAt} <= ${now.toISOString()}::timestamptz then ${expiresAt.toISOString()}::timestamptz else ${rateLimits.expiresAt} end`,
      },
    })
    .returning({ count: rateLimits.count, expiresAt: rateLimits.expiresAt });
  return {
    count: row?.count ?? 1,
    retryAfterSeconds: Math.max(1, Math.ceil(((row?.expiresAt ?? expiresAt).getTime() - now.getTime()) / 1000)),
  };
}

/** Drops windows that ended more than an hour ago. Run from the hourly cron. */
export async function sweepRateLimits(): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const gone = await db.delete(rateLimits).where(lt(rateLimits.expiresAt, cutoff)).returning({ key: rateLimits.key });
  const tokens = await db.delete(consumedTokens).where(lt(consumedTokens.expiresAt, cutoff)).returning({ jti: consumedTokens.jti });
  return gone.length + tokens.length;
}

/**
 * Marks a one-shot token as used (GK-9). Returns false when it was already
 * redeemed — the insert is the lock, so two parallel redemptions can't both win.
 */
export async function consumeTokenOnce(jti: string, purpose: string, expiresAt: Date): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .insert(consumedTokens)
    .values({ jti: jti.slice(0, 64), purpose, expiresAt })
    .onConflictDoNothing({ target: consumedTokens.jti })
    .returning({ jti: consumedTokens.jti });
  return rows.length > 0;
}

export async function isTokenConsumed(jti: string, purpose: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ jti: consumedTokens.jti })
    .from(consumedTokens)
    .where(and(eq(consumedTokens.jti, jti.slice(0, 64)), eq(consumedTokens.purpose, purpose)))
    .limit(1);
  return Boolean(row);
}
