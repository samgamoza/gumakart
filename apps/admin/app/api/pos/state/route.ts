import { NextResponse } from "next/server";
import {
  countOpenSyncIssues,
  ensureRegister,
  getBirReceiptHeader,
  getOpenShift,
  getShiftSummary,
  getTenantSettings,
  listShiftSales,
  vatConfigFromSettings,
} from "@gumakart/db";
import { getPosDeviceTenant, posErrorResponse, requirePosActor } from "@/lib/pos-auth";

/** Everything the register screen needs on load. */
export async function GET() {
  try {
    const actor = await requirePosActor();
    const [register, record, deviceTenant] = await Promise.all([
      ensureRegister(actor.tenantId),
      getTenantSettings(actor.tenantId),
      getPosDeviceTenant(),
    ]);
    const shift = await getOpenShift(actor.tenantId, register.id);
    const [summary, sales] = shift
      ? await Promise.all([getShiftSummary(actor.tenantId, shift.id), listShiftSales(actor.tenantId, shift.id, 30)])
      : [null, []];
    const receiving = record?.settings.payments?.receiving ?? {};
    const manager = actor.role === "owner" || actor.role === "manager";
    const [birHeader, offlineIssues] = await Promise.all([
      getBirReceiptHeader(actor.tenantId),
      manager ? countOpenSyncIssues(actor.tenantId) : Promise.resolve(0),
    ]);
    return NextResponse.json({
      ok: true,
      actor: { name: actor.name, role: actor.role, isStaff: Boolean(actor.staffId) || actor.role !== "owner", staffId: actor.staffId },
      shop: { name: record?.name ?? "", slug: record?.slug ?? "" },
      register,
      shift,
      summary,
      sales,
      vat: vatConfigFromSettings(record?.settings.pos),
      wallets: { gcash: Boolean(receiving.gcashNumber), maya: Boolean(receiving.mayaNumber) },
      deviceRegistered: deviceTenant === actor.tenantId,
      // Phase 12b: what the register needs to keep selling offline.
      bir: birHeader,
      offlineIssues,
    });
  } catch (error) {
    return posErrorResponse(error, "state");
  }
}
