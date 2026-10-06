import { getUserSessionById, isSessionCurrent } from "@gumakart/auth";
import { getPartnerForUser, type PartnerRow } from "@gumakart/db";
import { getSession } from "@/lib/session";
import { ApiAuthError } from "@/lib/api-auth";

/**
 * Phase 18: the signed-in partner (from the database, not the JWT role — the JWT says
 * seller_staff while the partner is working in a client shop).
 */
export async function requirePartner(): Promise<{ userId: string; email: string; displayName: string; sessionVersion: number; partner: PartnerRow }> {
  const session = await getSession();
  if (!session) throw new ApiAuthError("Not signed in.", 401);
  if (!(await isSessionCurrent(session.userId, session.sessionVersion))) throw new ApiAuthError("Session expired. Please sign in again.", 401);
  const user = await getUserSessionById(session.userId);
  if (!user || user.role !== "partner") throw new ApiAuthError("This isn't a partner account.", 403, "NOT_PARTNER");
  const partner = await getPartnerForUser(user.userId);
  if (!partner) throw new ApiAuthError("Partner profile not found.", 404, "NOT_PARTNER");
  return { userId: user.userId, email: user.email, displayName: user.displayName, sessionVersion: user.sessionVersion, partner };
}
