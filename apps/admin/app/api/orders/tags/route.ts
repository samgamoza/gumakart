import { NextResponse } from "next/server";
import { listOrderTags } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { afterSaleFail } from "@/lib/after-sale";

export async function GET() {
  try {
    const session = await requireTenantSession();
    return NextResponse.json({ ok: true, tags: await listOrderTags(session.tenantId) });
  } catch (error) {
    return afterSaleFail(error, "order tags");
  }
}
