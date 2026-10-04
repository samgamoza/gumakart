import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AUTH_COOKIE_NAME,
  createPosStaffToken,
  POS_STAFF_COOKIE,
  POS_STAFF_MAX_AGE,
  verifyPassword,
} from "@gumakart/auth";
import {
  getPosStaffForAuth,
  getTenantSettings,
  listPosStaff,
  PIN_LOCK_MINUTES,
  recordPinFailure,
  recordPinSuccess,
} from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { getPosDeviceTenant, posCookieOptions, posErrorResponse } from "@/lib/pos-auth";

/** Staff list for the PIN screen — only on a device the owner registered. */
export async function GET() {
  try {
    const tenantId = await getPosDeviceTenant();
    if (!tenantId) return NextResponse.json({ ok: true, device: false, staff: [] });
    const [staff, record] = await Promise.all([listPosStaff(tenantId, { activeOnly: true }), getTenantSettings(tenantId)]);
    return NextResponse.json({
      ok: true,
      device: true,
      shopName: record?.name ?? "",
      staff: staff.map((s) => ({ id: s.id, name: s.name, role: s.role })),
    });
  } catch (error) {
    return posErrorResponse(error, "login list");
  }
}

const bodySchema = z.object({ staffId: z.string().uuid(), pin: z.string().regex(/^\d{4,6}$/, "Enter your 4–6 digit PIN.") });

export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`pos-pin:${clientIpFrom(request)}`, { limit: 20, windowSeconds: 300 });
    if (!limited.allowed) {
      return NextResponse.json({ ok: false, error: "Too many tries. Wait a few minutes." }, { status: 429 });
    }
    const tenantId = await getPosDeviceTenant();
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "This device isn't set up as a register yet." }, { status: 403 });
    }
    const body = bodySchema.parse(await request.json());
    const staff = await getPosStaffForAuth(tenantId, body.staffId);
    if (!staff || !staff.active) return NextResponse.json({ ok: false, error: "Pick your name again." }, { status: 400 });
    if (staff.lockedUntil && staff.lockedUntil > new Date()) {
      const minutes = Math.ceil((staff.lockedUntil.getTime() - Date.now()) / 60_000);
      return NextResponse.json(
        { ok: false, error: `Too many wrong PINs. Try again in ${minutes} min, or ask the owner to reset your PIN.` },
        { status: 423 }
      );
    }
    if (!(await verifyPassword(body.pin, staff.pinHash))) {
      const { locked } = await recordPinFailure(staff.id);
      return NextResponse.json(
        { ok: false, error: locked ? `Wrong PIN. Locked for ${PIN_LOCK_MINUTES} minutes.` : "Wrong PIN." },
        { status: locked ? 423 : 401 }
      );
    }
    await recordPinSuccess(staff.id);
    const token = await createPosStaffToken({ tenantId, staffId: staff.id, pinVersion: staff.pinVersion });
    const res = NextResponse.json({ ok: true, name: staff.name, role: staff.role });
    // A cashier on the register must never ride on the owner's seller session:
    // unlocking with a PIN signs the owner out on this device.
    res.cookies.set(AUTH_COOKIE_NAME, "", posCookieOptions(0));
    res.cookies.set(POS_STAFF_COOKIE, token, posCookieOptions(POS_STAFF_MAX_AGE));
    return res;
  } catch (error) {
    return posErrorResponse(error, "login");
  }
}

/** Lock the register / switch cashier. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(POS_STAFF_COOKIE, "", posCookieOptions(0));
  return res;
}
