import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CHECKOUT_LINK_DELIVERY_MODES,
  CHECKOUT_LINK_MAX_ITEMS,
  CHECKOUT_LINK_PAYMENT_METHODS,
  CHECKOUT_LINK_SHARE_CHANNELS,
  CheckoutLinkError,
  createCheckoutLink,
  getCheckoutLinkShopOptions,
  listCheckoutLinksForTenant,
  tryAutoActivateTenant,
} from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { storefrontBaseUrl } from "@/lib/utils";

export async function GET() {
  try {
    const session = await requireTenantSession();
    const [links, options] = await Promise.all([
      listCheckoutLinksForTenant(session.tenantId),
      getCheckoutLinkShopOptions(session.tenantId),
    ]);
    return NextResponse.json({
      ok: true,
      links,
      options,
      linkBaseUrl: `${storefrontBaseUrl}/c/`,
    });
  } catch (error) {
    return errorResponse(error, "[checkout-links GET]");
  }
}

const createSchema = z.object({
  title: z.string().max(120).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullish(),
        quantity: z.number().int().min(1).max(99),
      })
    )
    .min(1)
    .max(CHECKOUT_LINK_MAX_ITEMS),
  shareChannel: z.enum(CHECKOUT_LINK_SHARE_CHANNELS).nullable().optional(),
  allowQuantityEdit: z.boolean().optional(),
  deliveryMode: z.enum(CHECKOUT_LINK_DELIVERY_MODES).optional(),
  paymentMethods: z.array(z.enum(CHECKOUT_LINK_PAYMENT_METHODS)).max(6).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  maxOrders: z.number().int().min(1).max(100000).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Check the link details and try again." }, { status: 400 });
    }
    const body = parsed.data;
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ ok: false, error: "The end date has to be in the future." }, { status: 400 });
    }
    const link = await createCheckoutLink(session.tenantId, session.userId, {
      title: body.title,
      items: body.items,
      shareChannel: body.shareChannel ?? null,
      allowQuantityEdit: body.allowQuantityEdit,
      deliveryMode: body.deliveryMode,
      paymentMethods: body.paymentMethods ?? null,
      expiresAt,
      maxOrders: body.maxOrders ?? null,
    });
    // Plan §9: a shop goes live when its first checkout link is created.
    await tryAutoActivateTenant(session.tenantId).catch((error) =>
      console.error("[checkout-links POST] auto-activate failed:", error)
    );
    await recordActivity(session, {
      action: "link.created",
      entityType: "checkout_link",
      entityId: link.id,
      summary: `Made checkout link "${link.title}" (/c/${link.code})`,
    });
    return NextResponse.json({ ok: true, link }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "[checkout-links POST]");
  }
}

function errorResponse(error: unknown, tag: string) {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof CheckoutLinkError) {
    const status = error.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status });
  }
  console.error(tag, error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}
