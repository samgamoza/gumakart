import { NextResponse } from "next/server";
import { z } from "zod";
import { listActivity } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

/** Owner + manager: the shop's activity log, newest first. */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const url = new URL(request.url);
    const actor = url.searchParams.get("actor");
    const kind = url.searchParams.get("kind");
    const before = url.searchParams.get("before");
    const rows = await listActivity(session.tenantId, {
      actorUserId: actor ? z.string().uuid().parse(actor) : null,
      actionPrefix: kind ? z.string().regex(/^[a-z_]{1,24}$/).parse(kind) + "." : null,
      before: before ? new Date(z.string().datetime().parse(before)) : null,
      limit: 50,
    });
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Bad filter." }, { status: 400 });
    console.error("[activity GET]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
