import { NextResponse } from "next/server";
import {
  countOpenSyncIssues,
  ensureRegister,
  getBirReceiptHeader,
  getOpenShift,
  getShiftSummary,
  getTenantSettings,
  getTenantCheckoutState,
  listBranches,
  listShiftSales,
  vatConfigFromSettings,
} from "@gumakart/db";
import { getPosDeviceTenant, posErrorResponse, requirePosActor, posBranchId } from "@/lib/pos-auth";

/** Everything the register screen needs on load. */
export async function GET() {
  try {
    const actor = await requirePosActor();
    const [register, record, deviceTenant, checkout, branchInfo] = await Promise.all([
      ensureRegister(actor.tenantId, await posBranchId()),
      getTenantSettings(actor.tenantId),
      getPosDeviceTenant(),
      getTenantCheckoutState(actor.tenantId),
      listBranches(actor.tenantId),
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
      // Phase 17: quantity deals + automatic discount (also cached for offline selling).
      // Phase 17: branches (shown only when the shop has more than one).
      branches: branchInfo.enabled ? branchInfo.branches.filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name })) : [],
      branchId: register.locationId,
      promotions: {
        volumeDiscounts: checkout?.published.volumeDiscounts ?? [],
        automaticDiscount: checkout?.published.automaticDiscount ?? null,
      },
    });
  } catch (error) {
    return posErrorResponse(error, "state");
  }
}
