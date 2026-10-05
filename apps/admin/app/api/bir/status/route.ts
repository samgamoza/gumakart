import { NextResponse } from "next/server";
import { BIR_REQUIRED, birMissing, getTenantSettings, listZReadings, zReadingStatus } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { afterSaleFail } from "@/lib/after-sale";

/** BIR switch state, missing PTU details, Z readings due and recent Z readings. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    const [record, registers, readings] = await Promise.all([
      getTenantSettings(session.tenantId),
      zReadingStatus(session.tenantId),
      listZReadings(session.tenantId, 30),
    ]);
    const bir = record?.settings.pos?.bir ?? {};
    return NextResponse.json({
      ok: true,
      bir,
      vatRegistered: Boolean(record?.settings.pos?.vatRegistered),
      required: BIR_REQUIRED,
      missing: birMissing(bir),
      active: Boolean(bir.enabled) && birMissing(bir).length === 0,
      registers,
      readings,
    });
  } catch (error) {
    return afterSaleFail(error, "bir status");
  }
}
