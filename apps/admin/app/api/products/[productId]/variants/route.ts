import { NextResponse } from "next/server";
import { z } from "zod";
import { getProductVariantsForTenant, saveProductVariants, VariantError } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

/** Phase 9 — a product's options (Size, Color…) and its variants. */

const putSchema = z.object({
  options: z
    .array(z.object({ name: z.string().max(40), values: z.array(z.string().max(40)).max(40) }))
    .max(5),
  variants: z
    .array(
      z.object({
        id: z.string().uuid().nullish(),
        options: z.record(z.string().max(40), z.string().max(40)),
        price: z.number().positive().max(999999),
        compareAtPrice: z.number().min(0).max(999999).nullish(),
        sku: z.string().max(100).nullish(),
        barcode: z.string().max(64).nullish(),
        stockQty: z.number().int().min(0).max(1_000_000),
        imageUrl: z.string().max(2048).nullish(),
      })
    )
    .min(1)
    .max(150),
});

function fail(error: unknown, label: string) {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof VariantError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Check the variant details." }, { status: 400 });
  }
  console.error(`[products variants ${label}]`, error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { productId } = await params;
    z.string().uuid().parse(productId);
    const view = await getProductVariantsForTenant(session.tenantId, productId);
    if (!view) return NextResponse.json({ ok: false, error: "Product not found." }, { status: 404 });
    return NextResponse.json({ ok: true, ...view, variants: view.variants.filter((v) => v.active) });
  } catch (error) {
    return fail(error, "GET");
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { productId } = await params;
    z.string().uuid().parse(productId);
    const body = putSchema.parse(await request.json());
    const view = await saveProductVariants(session.tenantId, productId, body, session.userId ?? null);
    return NextResponse.json({ ok: true, ...view, variants: view.variants.filter((v) => v.active) });
  } catch (error) {
    return fail(error, "PUT");
  }
}
