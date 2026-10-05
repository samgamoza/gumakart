import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlanReceipt } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  try {
    const session = await requireTenantSession({ allowSuspended: true });
    const { paymentId } = await params;
    if (!z.string().uuid().safeParse(paymentId).success) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    const receipt = await getPlanReceipt(session.tenantId, paymentId);
    if (!receipt) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, receipt });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[billing receipt]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
