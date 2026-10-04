import { NextResponse } from "next/server";
import { z } from "zod";
import { CHECKOUT_LINK_SHARE_CHANNELS, getCheckoutLinkForTenant, updateCheckoutLink } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

const idSchema = z.string().uuid();

// Items and payment/delivery choices are fixed once a link is out there, so a
// buyer never sees a different offer behind the same link. Make a new link instead.
const patchSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    active: z.boolean().optional(),
    shareChannel: z.enum(CHECKOUT_LINK_SHARE_CHANNELS).nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    maxOrders: z.number().int().min(1).max(100000).nullable().optional(),
  })
  .strict();

type Params = { params: Promise<{ linkId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireTenantSession();
    const { linkId } = await params;
    if (!idSchema.safeParse(linkId).success) return notFound();
    const link = await getCheckoutLinkForTenant(session.tenantId, linkId);
    return link ? NextResponse.json({ ok: true, link }) : notFound();
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireTenantSession();
    const { linkId } = await params;
    if (!idSchema.safeParse(linkId).success) return notFound();
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Check the link details and try again." }, { status: 400 });
    }
    const body = parsed.data;
    const link = await updateCheckoutLink(session.tenantId, linkId, {
      title: body.title,
      active: body.active,
      shareChannel: body.shareChannel,
      expiresAt: body.expiresAt === undefined ? undefined : body.expiresAt ? new Date(body.expiresAt) : null,
      maxOrders: body.maxOrders,
    });
    return link ? NextResponse.json({ ok: true, link }) : notFound();
  } catch (error) {
    return errorResponse(error);
  }
}

function notFound() {
  return NextResponse.json({ ok: false, error: "Link not found." }, { status: 404 });
}

function errorResponse(error: unknown) {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  console.error("[checkout-links/:id]", error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}
