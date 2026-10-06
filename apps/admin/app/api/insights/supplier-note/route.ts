import { NextResponse } from "next/server";
import { z } from "zod";
import { getRestockSuggestions } from "@gumakart/db";
import type { SupplierOutput } from "@gumakart/ai";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { runAssistForTenant } from "@/lib/ai-assist";

const schema = z.object({
  supplierName: z.string().trim().max(60).optional(),
  /** Which restock lines to include (default: all suggested). */
  variantIds: z.array(z.string().uuid()).max(20).optional(),
});

/** Harvest H1: a Taglish reorder message to the supplier with the restock card's exact quantities. */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = schema.parse(await request.json().catch(() => ({})));
    const lines = (await getRestockSuggestions(session.tenantId))
      .filter((r) => r.suggestedQty > 0 && (!body.variantIds || body.variantIds.includes(r.variantId)))
      .map((r) => ({ title: r.title, qty: r.suggestedQty, stock: r.stock }));
    if (!lines.length) return NextResponse.json({ ok: false, error: "Nothing to reorder right now." }, { status: 400 });
    const result = await runAssistForTenant<SupplierOutput>(session.tenantId, "supplier", {
      shopName: session.tenantName,
      supplierName: body.supplierName || null,
      items: lines,
    });
    if (!result.ok) return result.response;
    return NextResponse.json({ ok: true, message: result.output.message, items: lines });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Check the supplier name." }, { status: 400 });
    console.error("[insights/supplier-note]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
