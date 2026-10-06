import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteProductForTenant, markChangeRequestPublished, productSnapshot, updateProductForTenant } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { peso, recordActivity } from "@/lib/activity";

const patchSchema = z.object({
  title: z.string().min(2).max(255).optional(),
  descriptionHtml: z.string().max(20000).optional(),
  basePrice: z.number().positive().max(999999).optional(),
  compareAtPrice: z.number().positive().max(999999).nullable().optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  stockQty: z.number().int().min(0).max(99999).optional(),
  imageUrl: z.string().max(2048).nullable().optional(),
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

const idSchema = z.string().uuid();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const session = await requireTenantSession();
    const { productId } = await params;
    const id = idSchema.parse(productId);
    const body = patchSchema.parse(await request.json());

    const before = await productSnapshot(session.tenantId, id);
    const updated = await updateProductForTenant(session.tenantId, id, {
      title: body.title,
      descriptionHtml: body.descriptionHtml,
      basePrice: body.basePrice !== undefined ? body.basePrice.toFixed(2) : undefined,
      compareAtPrice:
        body.compareAtPrice === undefined
          ? undefined
          : body.compareAtPrice === null
            ? null
            : body.compareAtPrice.toFixed(2),
      status: body.status,
      stockQty: body.stockQty,
      imageUrl: body.imageUrl,
      isMain: body.isMain,
      metadataJson: body.metadataJson,
    });

    if (!updated) {
      return NextResponse.json({ ok: false, error: "Product not found." }, { status: 404 });
    }

    // Phase 10: price, stock and status changes go to the activity log.
    const after = before ? await productSnapshot(session.tenantId, id) : null;
    if (before && after) {
      const changes: string[] = [];
      if (after.price !== before.price) changes.push(`price ${peso(before.price)} → ${peso(after.price)}`);
      if (after.stock !== before.stock) changes.push(`stock ${before.stock} → ${after.stock}`);
      if (after.status !== before.status) changes.push(`${before.status} → ${after.status}`);
      if (after.title !== before.title) changes.push(`renamed from "${before.title}"`);
      if (changes.length) {
        await recordActivity(session, {
          action: changes.some((c) => c.startsWith("price")) ? "product.price_changed" : changes.some((c) => c.startsWith("stock")) ? "product.stock_changed" : "product.updated",
          entityType: "product",
          entityId: id,
          summary: `${after.title}: ${changes.join(", ")}`,
        });
      }
    }

    if (body.changeRequestId) {
      await markChangeRequestPublished({
        id: body.changeRequestId,
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email ?? null,
        productId: id,
      });
      try {
        const { ensureEventsWired } = await import("@/lib/events-bootstrap");
        ensureEventsWired();
        const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
        await emitDomainEvent({
          name: EVENT_NAMES.PRICING_CHANGE_APPROVED,
          data: {
            tenantId: session.tenantId,
            changeRequestId: body.changeRequestId,
            productId: id,
            basePrice: body.basePrice !== undefined ? String(body.basePrice) : undefined,
          },
          idempotencyKey: `Pricing.ChangeApproved.V1:${body.changeRequestId}`,
        });
      } catch (err) {
        console.error("[products PATCH] pricing event", err);
      }
    }

    return NextResponse.json({ ok: true });
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
    console.error("[products PATCH]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const session = await requireTenantSession();
    const { productId } = await params;
    const id = idSchema.parse(productId);

    const before = await productSnapshot(session.tenantId, id);
    const result = await deleteProductForTenant(session.tenantId, id);
    if (result === "not_found") {
      return NextResponse.json({ ok: false, error: "Product not found." }, { status: 404 });
    }
    await recordActivity(session, {
      action: "product.deleted",
      entityType: "product",
      entityId: id,
      summary: `${result === "archived" ? "Archived" : "Deleted"} ${before?.title ?? "a product"}`,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid product id." }, { status: 400 });
    }
    console.error("[products DELETE]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
