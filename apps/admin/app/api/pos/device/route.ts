import { NextResponse } from "next/server";
import { createPosDeviceToken, POS_DEVICE_COOKIE, POS_DEVICE_MAX_AGE, POS_STAFF_COOKIE } from "@gumakart/auth";
import { posCookieOptions, posErrorResponse, requirePosOwner } from "@/lib/pos-auth";

/** Owner marks this phone/tablet as the shop's register (cashiers can then unlock it with a PIN). */
export async function POST() {
  try {
    const owner = await requirePosOwner();
    const token = await createPosDeviceToken({ tenantId: owner.tenantId });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(POS_DEVICE_COOKIE, token, posCookieOptions(POS_DEVICE_MAX_AGE));
    return res;
  } catch (error) {
    return posErrorResponse(error, "device");
  }
}

/** Stop using this device as a register. */
export async function DELETE() {
  try {
    await requirePosOwner();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(POS_DEVICE_COOKIE, "", posCookieOptions(0));
    res.cookies.set(POS_STAFF_COOKIE, "", posCookieOptions(0));
    return res;
  } catch (error) {
    return posErrorResponse(error, "device delete");
  }
}
