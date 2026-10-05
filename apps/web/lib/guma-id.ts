import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { BUYER_COOKIE, BUYER_MAX_AGE, buyerSessionsConfigured, createBuyerToken, verifyBuyerToken } from "@gumakart/auth/buyer-token";
import { getBuyer, GumaIdError, type BuyerAccount } from "@gumakart/db";
import { allowIntegrationMocks } from "@gumakart/services";

/**
 * Phase 12 — Guma ID on the storefront. Available when buyer sessions can be signed and
 * SMS can be sent (Semaphore key set, or the labeled local mock). Until then every Guma
 * ID surface shows "coming soon" and checkout works exactly as before.
 */
export function gumaIdStatus(): { available: boolean; smsMock: boolean } {
  const sms = Boolean(process.env.SEMAPHORE_API_KEY?.trim());
  const mock = !sms && allowIntegrationMocks();
  return { available: buyerSessionsConfigured() && (sms || mock), smsMock: mock };
}

function cookieOptions(maxAge: number) {
  const override = process.env.AUTH_COOKIE_SECURE;
  const secure = override === "false" || override === "0" ? false : override === "true" || override === "1" ? true : process.env.NODE_ENV === "production";
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge };
}

export async function setBuyerCookie(res: NextResponse, buyer: BuyerAccount): Promise<void> {
  res.cookies.set(BUYER_COOKIE, await createBuyerToken({ buyerId: buyer.id, sessionVersion: buyer.sessionVersion }), cookieOptions(BUYER_MAX_AGE));
}

export function clearBuyerCookie(res: NextResponse): void {
  res.cookies.set(BUYER_COOKIE, "", cookieOptions(0));
}

/** The signed-in buyer, or null (bad/old cookie, signed out everywhere, deleted). */
export async function currentBuyer(): Promise<BuyerAccount | null> {
  if (!gumaIdStatus().available) return null;
  const store = await cookies();
  const claims = await verifyBuyerToken(store.get(BUYER_COOKIE)?.value);
  if (!claims) return null;
  const buyer = await getBuyer(claims.buyerId).catch(() => null);
  return buyer && buyer.sessionVersion === claims.sessionVersion ? buyer : null;
}

export class BuyerAuthError extends Error {}

export async function requireBuyer(): Promise<BuyerAccount> {
  const buyer = await currentBuyer();
  if (!buyer) throw new BuyerAuthError("Mag-sign in muna sa Guma ID.");
  return buyer;
}

export function idFail(error: unknown, label: string) {
  if (error instanceof BuyerAuthError) return NextResponse.json({ ok: false, error: error.message, code: "SIGNED_OUT" }, { status: 401 });
  if (error instanceof GumaIdError) {
    const status = error.code === "RATE_LIMITED" || error.code === "TOO_MANY_TRIES" ? 429 : error.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status });
  }
  if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Pakicheck ang detalye." }, { status: 400 });
  console.error(`[guma-id ${label}]`, error);
  return NextResponse.json({ ok: false, error: "May problema. Subukan ulit." }, { status: 500 });
}

export function unavailable() {
  return NextResponse.json({ ok: false, error: "Hindi pa naka-on ang Guma ID.", code: "UNAVAILABLE" }, { status: 503 });
}
