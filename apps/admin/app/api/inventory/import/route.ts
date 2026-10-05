import { NextResponse } from "next/server";
import { z } from "zod";
import { applyStockChanges, planInventoryCsvImport } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { inventoryFail } from "../_errors";
import { recordActivity } from "@/lib/activity";

const schema = z.object({
  csv: z.string().min(1, "Choose a CSV file.").max(1_000_000, "The file is too big (1 MB max)."),
  /** false = preview only. */
  apply: z.boolean().default(false),
});

/**
 * Stock/price update from a CSV. Always plans first; with apply=true the same
 * plan is written in one transaction (all rows or none).
 */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = schema.parse(await request.json());
    const plan = await planInventoryCsvImport(session.tenantId, body.csv);
    if (!body.apply || plan.changes.length === 0) {
      return NextResponse.json({ ok: true, applied: false, ...plan });
    }
    const result = await applyStockChanges(
      session.tenantId,
      plan.changes.map(({ variantId, stockQty, price }) => ({ variantId, stockQty, price })),
      { note: "CSV import", actorId: session.userId ?? null }
    );
    await recordActivity(session, {
      action: "stock.imported",
      entityType: "stock",
      summary: `CSV import — ${result.changed} item${result.changed === 1 ? "" : "s"} updated (price/stock)`,
      meta: { changes: plan.changes.slice(0, 200).map(({ label, fromStock, stockQty, fromPrice, price }) => ({ label, fromStock, stockQty, fromPrice, price })) },
    });
    return NextResponse.json({ ok: true, applied: true, ...plan, ...result });
  } catch (error) {
    return inventoryFail(error, "import");
  }
}
