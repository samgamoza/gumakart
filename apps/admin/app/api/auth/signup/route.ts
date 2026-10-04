import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, normalizeCodeEmail, readSignupTicket, registerSeller, sessionCookieHeader } from "@gumakart/auth";
import { saveBusinessProfile } from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { businessProfileFields } from "@/lib/business-profile";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2).max(100),
  shopName: z.string().min(2).max(255),
  shopSlug: z.string().min(3).max(32).optional(),
  category: z.string().optional(),
  vibe: z.string().max(32).optional(),
  ...businessProfileFields,
  /** From /api/auth/signup/verify — proof this email passed the emailed code. */
  ticket: z.string({ required_error: "Confirm your email first." }).min(20, "Confirm your email first."),
});

export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`signup:${clientIpFrom(request)}`, {
      limit: 5,
      windowSeconds: 600,
    });
    if (!limited.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many signups from this connection. Try again later." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
      );
    }

    const { ticket, mobile, sellChannels, chatUrl, ...body } = signupSchema.parse(await request.json());
    const ticketEmail = await readSignupTicket(ticket);
    if (!ticketEmail || ticketEmail !== normalizeCodeEmail(body.email)) {
      return NextResponse.json(
        { ok: false, error: "Your email confirmation expired. Go back and enter a new code.", code: "TICKET_INVALID" },
        { status: 400 }
      );
    }
    const { user, sessionToken } = await registerSeller({ ...body, emailVerified: true });
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
      return NextResponse.json(
        { ok: false, error: error.errors[0]?.message ?? "Invalid input", code: "VALIDATION" },
        { status: 400 }
      );
    }
    console.error("[auth/signup]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
