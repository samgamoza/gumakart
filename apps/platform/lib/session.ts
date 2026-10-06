import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AUTH_COOKIE_NAME,
  isSessionCurrent,
  verifySessionToken,
  type SessionPayload,
} from "@gumakart/auth";

export type { SessionPayload };

/**
 * A valid ops session (Phase 21): a super-admin token that passed the two-step check and hasn't
 * been revoked since (sign-out-everywhere / password change bump the session version).
 * Cached per request so a page and its actions check the database once.
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session || session.role !== "super_admin" || !session.mfa) return null;
  if (!(await isSessionCurrent(session.userId, session.sessionVersion))) return null;
  return session;
});

/** Server-component guard: only two-step-verified super_admins may proceed. */
export async function requireSuperAdmin(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
