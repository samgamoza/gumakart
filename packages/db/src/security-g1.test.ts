import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "./client";
import { consumeTokenOnce, dbRateLimitHit, sweepRateLimits } from "./queries/rate-limits";
import { sendWithLog, SMS_DAILY_CAP_MARKETING } from "./queries/message-log";
import { messageLog, rateLimits, tenants } from "./schema/index";

/*
  Security slice G1 (audit 2026-10-07): the shared rate-limit counter, single-use tokens
  and the per-number SMS ceiling. Needs the local Postgres with 0043 applied:
  DATABASE_URL=postgres://postgres@127.0.0.1:5434/gumakart npx tsx --test src/security-g1.test.ts
*/

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) {
  throw new Error("Refusing to run destructive tests against a hosted database.");
}
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres on :5434).");

const db = getDb();
const run = randomUUID().slice(0, 8);

after(async () => {
  await db.delete(messageLog).where(eq(messageLog.recipient, "+639170009999"));
  await db.delete(tenants).where(eq(tenants.slug, `test-g1-${run}`));
  await closeDb();
});

test("GK-2: 30 parallel hits on one key count exactly 30, across connections", async () => {
  const key = `test:g1:${run}`;
  const results = await Promise.all(Array.from({ length: 30 }, () => dbRateLimitHit(key, { limit: 10, windowSeconds: 60 }, true)));
  const counts = results.map((r) => r.count).sort((a, b) => a - b);
  assert.deepEqual(counts, Array.from({ length: 30 }, (_, i) => i + 1), "every hit got a distinct count — nothing lost to a race");
  assert.equal(results.filter((r) => r.count > 10).length, 20, "20 of 30 are over a limit of 10");
  const peek = await dbRateLimitHit(key, { limit: 10, windowSeconds: 60 }, false);
  assert.equal(peek.count, 30, "a peek does not spend a hit");
  // An expired window restarts at 1.
  await db.update(rateLimits).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(rateLimits.key, key));
  assert.equal((await dbRateLimitHit(key, { limit: 10, windowSeconds: 60 }, true)).count, 1);
  await db.update(rateLimits).set({ expiresAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(rateLimits.key, key));
  assert.ok((await sweepRateLimits()) >= 1, "the sweep drops old windows");
});

test("GK-9: a one-shot token is redeemed exactly once even under parallel use", async () => {
  const jti = `jti-${run}`;
  const wins = await Promise.all(Array.from({ length: 8 }, () => consumeTokenOnce(jti, "support_access", new Date(Date.now() + 60_000))));
  assert.equal(wins.filter(Boolean).length, 1);
});

test("GK-7: a phone number gets at most the daily marketing cap, platform-wide", async () => {
  const [tenant] = await db.insert(tenants).values({ slug: `test-g1-${run}`, name: "G1 Shop", status: "active" }).returning();
  const outcomes: string[] = [];
  for (let i = 0; i < SMS_DAILY_CAP_MARKETING + 2; i++) {
    const r = await sendWithLog(
      { tenantId: tenant!.id, channel: "sms", kind: "marketing", recipient: "09170009999", recipe: `g1-test-${i}`, entityId: `${run}-${i}`, body: `Hi! https://kart.guma.one/stop/abc.def` },
      async () => ({ success: true, messageId: `m-${i}` })
    );
    outcomes.push(r.status === "suppressed" ? r.reason : r.status);
  }
  assert.deepEqual(outcomes, [...Array(SMS_DAILY_CAP_MARKETING).fill("sent"), "daily_cap", "daily_cap"]);
});
