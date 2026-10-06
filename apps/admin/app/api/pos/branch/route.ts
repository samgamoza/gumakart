import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureRegister, getOpenShift, getDb, resolvePosLocationId } from "@gumakart/db";
import { POS_BRANCH_COOKIE, posBranchId, posErrorResponse, requirePosActor } from "@/lib/pos-auth";

/** Phase 17: switch which branch this register device sells from (owner/manager, no open shift). */
export async function POST(request: Request) {
  try {
    const actor = await requirePosActor();
    if (actor.role === "cashier") return NextResponse.json({ ok: false, error: "Ask a manager to switch the branch." }, { status: 403 });
    const { locationId } = z.object({ locationId: z.string().uuid() }).parse(await request.json());
    const current = await ensureRegister(actor.tenantId, await posBranchId());
    if (await getOpenShift(actor.tenantId, current.id)) {
      return NextResponse.json({ ok: false, error: "Close this branch's shift before switching." }, { status: 409 });
    }
    const resolved = await resolvePosLocationId(getDb(), actor.tenantId, locationId);
    if (resolved !== locationId) return NextResponse.json({ ok: false, error: "That branch isn't available." }, { status: 400 });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(POS_BRANCH_COOKIE, locationId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86_400 });
    return res;
  } catch (error) {
    return posErrorResponse(error, "branch");
  }
}
