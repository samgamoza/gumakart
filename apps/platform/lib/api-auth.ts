import { getSession } from "@/lib/session";
import type { SessionPayload } from "@gumakart/auth";

export class ApiAuthError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}

/** Route-handler / server-action guard: throws unless caller is a super_admin. */
export async function requireSuperAdminApi(): Promise<SessionPayload> {
  const session = await getSession();
  // getSession() only returns two-step-verified, current super-admin sessions (Phase 21).
  if (!session) {
    throw new ApiAuthError("Not signed in.", 401);
  }
  return session;
}
