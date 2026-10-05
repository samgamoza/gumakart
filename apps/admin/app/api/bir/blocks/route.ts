import { NextResponse } from "next/server";
import { z } from "zod";
import { listInvoiceBlocks, PosOfflineError, releaseInvoiceBlock } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { afterSaleFail } from "@/lib/after-sale";

/** Offline invoice blocks per device, with how many numbers were used. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    return NextResponse.json({ ok: true, blocks: await listInvoiceBlocks(session.tenantId) });
  } catch (error) {
    return afterSaleFail(error, "invoice blocks");
  }
}

/** A device is lost or retired: release its block (unused numbers are never issued). */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const { blockId } = z.object({ blockId: z.string().uuid() }).parse(await request.json());
    const block = await releaseInvoiceBlock(session.tenantId, blockId, session.displayName ?? "Seller");
    await recordActivity(session, {
      action: "pos.invoice_block_released",
      entityType: "pos_invoice_block",
      entityId: block.id,
      summary: `Released offline invoice numbers ${block.from}–${block.to}`,
    });
    return NextResponse.json({ ok: true, block });
  } catch (error) {
    if (error instanceof PosOfflineError) return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    return afterSaleFail(error, "invoice blocks");
  }
}
