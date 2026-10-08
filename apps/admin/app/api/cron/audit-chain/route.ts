import { NextResponse } from "next/server";
import { runAuditChainCheck, withCronLock } from "@gumakart/db";
import { isCronAuthorized } from "@/lib/cron-auth";

/**
 * Security G3 (GK-20): daily. Verifies every shop's audit chain (and the
 * platform chain) against the head recorded by the previous check, stores the
 * result in audit_chain_checks, and prints each head to the Worker log — a copy
 * that lives outside the database, so a database-side rewrite that also rewrote
 * the check table still disagrees with yesterday's log line.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const results = await withCronLock("audit-chain", () => runAuditChainCheck(), 1800);
  if (!results) return NextResponse.json({ ok: true, skipped: "another run is still going" });
  for (const r of results) {
    const line = { at: "audit-chain", tenant: r.tenantId ?? "platform", ok: r.ok, rows: r.checked, head: r.lastHash, headSeq: r.lastSeq, problem: r.problem };
    if (r.ok) console.info(JSON.stringify(line));
    else console.error(JSON.stringify(line));
  }
  const broken = results.filter((r) => !r.ok);
  return NextResponse.json({ ok: broken.length === 0, chains: results.length, broken: broken.map((r) => ({ tenantId: r.tenantId, problem: r.problem })) });
}
