import { NextResponse } from "next/server";
import { lookupPartnerCode } from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";

/** Phase 18: public — the agency name behind a partner code (signup banner, owner preview). */
export async function GET(request: Request) {
  const limited = await rateLimit(`partner-code:${clientIpFrom(request)}`, { limit: 30, windowSeconds: 60 });
  if (!limited.allowed) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const code = new URL(request.url).searchParams.get("code") ?? "";
  const p = await lookupPartnerCode(code);
  if (!p || p.status === "suspended") return NextResponse.json({ ok: false, error: "No partner with that code." }, { status: 404 });
  return NextResponse.json({ ok: true, partner: { name: p.name, code: p.code, city: p.city, website: p.website, approved: p.status === "active" } });
}
