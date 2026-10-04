import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  POS_DEVICE_COOKIE,
  POS_STAFF_COOKIE,
  verifyPosDeviceToken,
  verifyPosStaffToken,
} from "@gumakart/auth";
import { getPosStaffForAuth, getTenantStatusById, PosError } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

/**
 * Who is using the register.
 *  - A cashier/manager who unlocked it with their PIN (gk_pos_staff cookie), or
 *  - the shop owner's normal seller session (acts as manager).
 * The PIN cookie wins when both exist, so sales are credited to whoever unlocked.
 */
export interface PosActor {
  tenantId: string;
  staffId: string | null;
  userId: string | null;
  name: string;
  role: "owner" | "manager" | "cashier";
}

export async function getPosActor(): Promise<PosActor | null> {
  const store = await cookies();
  const staffClaims = await verifyPosStaffToken(store.get(POS_STAFF_COOKIE)?.value);
  if (staffClaims) {
    const staff = await getPosStaffForAuth(staffClaims.tenantId, staffClaims.staffId);
    const status = staff ? await getTenantStatusById(staff.tenantId) : null;
    if (staff && staff.active && staff.pinVersion === staffClaims.pinVersion && status && status !== "suspended") {
      return { tenantId: staff.tenantId, staffId: staff.id, userId: null, name: staff.name, role: staff.role };
    }
  }
  try {
    const session = await requireTenantSession();
    return {
      tenantId: session.tenantId,
      staffId: null,
      userId: session.userId,
      name: session.displayName?.split(" ")[0] || "Owner",
      role: "owner",
    };
  } catch {
    return null;
  }
}

export async function requirePosActor(): Promise<PosActor> {
  const actor = await getPosActor();
  if (!actor) throw new ApiAuthError("Unlock the register with your PIN.", 401, "POS_LOCKED");
  return actor;
}

/** The owner's seller session only (staff setup, registering a device). */
export async function requirePosOwner(): Promise<PosActor & { role: "owner" }> {
  const session = await requireTenantSession();
  return {
    tenantId: session.tenantId,
    staffId: null,
    userId: session.userId,
    name: session.displayName?.split(" ")[0] || "Owner",
    role: "owner",
  };
}

export async function getPosDeviceTenant(): Promise<string | null> {
  const store = await cookies();
  return (await verifyPosDeviceToken(store.get(POS_DEVICE_COOKIE)?.value))?.tenantId ?? null;
}

export function posErrorResponse(error: unknown, label: string): NextResponse {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof PosError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 400 });
  }
  if (error && typeof error === "object" && (error as { name?: string }).name === "OrderError") {
    return NextResponse.json({ ok: false, error: (error as Error).message, code: (error as { code?: string }).code }, { status: 400 });
  }
  if (error && typeof error === "object" && (error as { name?: string }).name === "ZodError") {
    const issues = (error as { errors?: Array<{ message: string }> }).errors;
    return NextResponse.json({ ok: false, error: issues?.[0]?.message ?? "Check the details." }, { status: 400 });
  }
  console.error(`[pos] ${label}`, error);
  return NextResponse.json({ ok: false, error: "Something went wrong. Try again." }, { status: 500 });
}

export function posCookieOptions(maxAge: number) {
  const override = process.env.AUTH_COOKIE_SECURE;
  const secure = override === "false" || override === "0" ? false : override === "true" || override === "1" ? true : process.env.NODE_ENV === "production";
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge };
}
