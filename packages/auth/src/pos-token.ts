import { jwtVerify, SignJWT } from "jose";

/**
 * POS Lite cookies (plan §12). Separate from the seller session:
 *  - device cookie: the owner, signed in, marks a phone/tablet as the shop's
 *    register. It lets cashiers see the staff list and enter a PIN there.
 *  - staff cookie: a cashier/manager unlocked the register with their PIN. It
 *    only opens /pos and /api/pos/* — never the rest of the seller console.
 * Signed with a key derived from AUTH_SECRET, so a POS token can never be read
 * as a seller session (or the other way round).
 */

export const POS_DEVICE_COOKIE = "gk_pos_device";
export const POS_STAFF_COOKIE = "gk_pos_staff";
export const POS_DEVICE_MAX_AGE = 180 * 24 * 60 * 60;
export const POS_STAFF_MAX_AGE = 14 * 60 * 60;

function key(): Uint8Array {
  const secret =
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "development" ? "dev-only-gumakart-auth-secret-min-32-chars" : undefined);
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET is missing or too short.");
  return new TextEncoder().encode(`${secret}:gumakart-pos-v1`);
}

export interface PosDeviceClaims {
  tenantId: string;
}

export interface PosStaffClaims {
  tenantId: string;
  staffId: string;
  /** posStaff.pinVersion at login; a PIN reset / deactivation invalidates it. */
  pinVersion: number;
}

export async function createPosDeviceToken(claims: PosDeviceClaims): Promise<string> {
  return new SignJWT({ t: claims.tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("gk-pos-device")
    .setIssuedAt()
    .setExpirationTime(`${POS_DEVICE_MAX_AGE}s`)
    .sign(key());
}

export async function verifyPosDeviceToken(token: string | null | undefined): Promise<PosDeviceClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { audience: "gk-pos-device" });
    return typeof payload.t === "string" ? { tenantId: payload.t } : null;
  } catch {
    return null;
  }
}

export async function createPosStaffToken(claims: PosStaffClaims): Promise<string> {
  return new SignJWT({ t: claims.tenantId, v: claims.pinVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("gk-pos-staff")
    .setSubject(claims.staffId)
    .setIssuedAt()
    .setExpirationTime(`${POS_STAFF_MAX_AGE}s`)
    .sign(key());
}

export async function verifyPosStaffToken(token: string | null | undefined): Promise<PosStaffClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { audience: "gk-pos-staff" });
    if (typeof payload.t !== "string" || typeof payload.sub !== "string" || typeof payload.v !== "number") return null;
    return { tenantId: payload.t, staffId: payload.sub, pinVersion: payload.v };
  } catch {
    return null;
  }
}

/** 4–6 digits, not all the same, not a straight run. */
export function validatePosPin(pin: string): { ok: true } | { ok: false; reason: string } {
  if (!/^\d{4,6}$/.test(pin)) return { ok: false, reason: "PIN must be 4 to 6 digits." };
  if (/^(\d)\1+$/.test(pin)) return { ok: false, reason: "Don't use the same digit for the whole PIN." };
  if ("0123456789".includes(pin) || "9876543210".includes(pin)) return { ok: false, reason: "Avoid 1234-style PINs." };
  return { ok: true };
}
