import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, completeGoogleShopSetup, sessionCookieHeader } from "@gumakart/auth";
import { saveBusinessProfile } from "@gumakart/db";
import { getSessionFromRequest } from "@/lib/session";
import { businessProfileFields } from "@/lib/business-profile";

const schema = z.object({
  shopName: z.string().min(2).max(255),
  shopSlug: z.string().min(3).max(32).optional(),
  category: z.string().optional(),
  vibe: z.string().max(32).optional(),
  ...businessProfileFields,
});

export async function POST(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    }
    if (!session.needsShopSetup) {
      return NextResponse.json({ ok: false, error: "Shop already set up." }, { status: 400 });
    }

    const { mobile, sellChannels, chatUrl, ...body } = schema.parse(await request.json());
    const { user, sessionToken } = await completeGoogleShopSetup({
      userId: session.userId,
      ...body,
    });
    if (user.tenantId) await saveBusinessProfile(user.tenantId, { mobile, sellChannels, chatUrl });

    if (user.tenantId && user.tenantSlug) {
      const { ensureEventsWired } = await import("@/lib/events-bootstrap");
      ensureEventsWired();
      const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
      await emitDomainEvent({
        name: EVENT_NAMES.TENANT_CREATED,
        data: {
          tenantId: user.tenantId,
          slug: user.tenantSlug,
          name: user.tenantName ?? body.shopName,
          plan: "free",
        },
        idempotencyKey: `Tenant.Created.V1:${user.tenantId}`,
      });
    }

    const response = NextResponse.json({
      ok: true,
      user,
      redirectTo: "/onboarding",
    });
    response.headers.set("Set-Cookie", sessionCookieHeader(sessionToken));
    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid shop details." }, { status: 400 });
    }
    console.error("[auth/google/complete-shop]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
