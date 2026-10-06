import { NextResponse } from "next/server";
import { z } from "zod";
import { createProductForTenant, listProductsForTenant, markChangeRequestPublished, tryAutoActivateTenant } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { peso, recordActivity } from "@/lib/activity";

export async function GET() {
  try {
    const session = await requireTenantSession();
    // Existing shops that already have products should go live without a separate Activate click.
    await tryAutoActivateTenant(session.tenantId);
    const products = await listProductsForTenant(session.tenantId);
    return NextResponse.json({ ok: true, products });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[products GET]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}

const createSchema = z.object({
  title: z.string().min(2).max(255),
  slug: z.string().optional(),
  descriptionHtml: z.string().optional(),
  basePrice: z.number().positive().max(999999),
  compareAtPrice: z.number().positive().max(999999).optional().nullable(),
  status: z.enum(["draft", "active"]).optional(),
  stockQty: z.number().int().min(0).max(99999).optional(),
  aiGenerated: z.boolean().optional(),
  imageUrl: z.string().max(2048).optional(),
  isMain: z.boolean().optional(),
  metadataJson: z
    .object({
      unitType: z.enum(["pc", "box", "other"]).optional(),
      unitCustom: z.string().max(40).optional(),
      servicePriceStyle: z.enum(["base_minimum", "value_range"]).optional(),
      preorder: z
        .object({ enabled: z.boolean().optional(), shipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
        .optional(),
    })
    .nullable()
    .optional(),
  changeRequestId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = createSchema.parse(await request.json());

    const product = await createProductForTenant(session.tenantId, {
      title: body.title,
      slug: body.slug ?? body.title,
      descriptionHtml: body.descriptionHtml,
      basePrice: body.basePrice.toFixed(2),
      compareAtPrice: body.compareAtPrice ? body.compareAtPrice.toFixed(2) : undefined,
      status: body.status ?? "active",
      stockQty: body.stockQty,
      aiGenerated: body.aiGenerated ?? false,
      imageUrl: body.imageUrl,
      isMain: body.isMain,
      metadataJson: body.metadataJson ?? null,
    });

    if (body.changeRequestId) {
      await markChangeRequestPublished({
        id: body.changeRequestId,
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email ?? null,
        productId: product.id,
      });
      const { ensureEventsWired } = await import("@/lib/events-bootstrap");
      ensureEventsWired();
      const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
      await emitDomainEvent({
        name: EVENT_NAMES.CATALOG_CHANGE_APPROVED,
        data: {
          tenantId: session.tenantId,
          changeRequestId: body.changeRequestId,
          productId: product.id,
        },
        idempotencyKey: `Catalog.ChangeApproved.V1:${body.changeRequestId}`,
      });
    }

    await recordActivity(session, {
      action: "product.created",
      entityType: "product",
      entityId: product.id,
      summary: `Added ${product.title} at ${peso(product.basePrice)}`,
    });
    return NextResponse.json({ ok: true, product });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: error.errors[0]?.message ?? "Invalid product data." },
        { status: 400 }
      );
    }
    console.error("[products POST]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
