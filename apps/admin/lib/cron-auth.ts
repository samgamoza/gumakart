import { timingSafeEqual } from "node:crypto";

/**
 * Phase 19: one guard for every /api/cron/* route (was 11 copies). Bearer CRON_SECRET, compared in
 * constant time. Without CRON_SECRET it only allows calls outside production (local dev).
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
