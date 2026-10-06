import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeCodeEmail, readSignupTicket, registerPartnerUser, sessionCookieHeader, sessionTokenForUser } from "@gumakart/auth";
import { createPartnerProfile } from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { partnerFail } from "@/lib/partner-api";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().trim().min(2).max(100),
  agencyName: z.string().trim().min(2, "Enter your agency or business name.").max(120),
  phone: z.string().trim().max(20).optional(),
  website: z.string().trim().max(255).optional(),
  city: z.string().trim().max(120).optional(),
  about: z.string().trim().max(500).optional(),
  /** From /api/auth/signup/verify — proof the email passed the emailed code. */
  ticket: z.string({ required_error: "Confirm your email first." }).min(20, "Confirm your email first."),
});

/** Phase 18: agency partner signup (status pending until Guma Kart ops approves). */
export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`partner-signup:${clientIpFrom(request)}`, { limit: 5, windowSeconds: 600 });
    if (!limited.allowed) {
      return NextResponse.json({ ok: false, error: "Too many signups from this connection. Try again later." }, { status: 429 });
    }
    const body = schema.parse(await request.json());
    const ticketEmail = await readSignupTicket(body.ticket);
    if (!ticketEmail || ticketEmail !== normalizeCodeEmail(body.email)) {
      return NextResponse.json({ ok: false, error: "Your email confirmation expired. Go back and enter a new code.", code: "TICKET_INVALID" }, { status: 400 });
    }
    const { userId } = await registerPartnerUser({ email: body.email, password: body.password, displayName: body.displayName, emailVerified: true });
    const partner = await createPartnerProfile({
      userId,
      name: body.agencyName,
      contactEmail: body.email,
      phone: body.phone,
      website: body.website,
      city: body.city,
      about: body.about,
    });
    const own = await sessionTokenForUser(userId);
    const response = NextResponse.json({ ok: true, partner: { code: partner.code, status: partner.status }, redirectTo: "/partner" });
    if (own) response.headers.set("Set-Cookie", sessionCookieHeader(own.sessionToken));
    return response;
  } catch (error) {
    return partnerFail(error, "signup");
  }
}
