import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

/**
 * Harvest H3: online orders (not POS sales) placed after `since`, for the dashboard's new-order chime.
 * Cheap: one indexed count + the newest row.
 */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const raw = new URL(request.url).searchParams.get("since");
    const since = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : new Date(Date.now() - 60_000);
    const rows = (await getDb().execute(sql`
      select o.order_number, o.total::text as total, o.created_at, count(*) over () as n
      from orders o
      where o.tenant_id = ${session.tenantId} and o.created_at > ${since.toISOString()}::timestamptz
        and o.register_session_id is null
      order by o.created_at desc
      limit 1`)) as unknown as Array<{ order_number: string; total: string; created_at: string; n: string }>;
    const top = rows[0];
    return NextResponse.json({
      ok: true,
      count: top ? Number(top.n) : 0,
      latest: top ? { orderNumber: top.order_number, total: Number(top.total), createdAt: new Date(top.created_at).toISOString() } : null,
      now: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[orders/latest]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
