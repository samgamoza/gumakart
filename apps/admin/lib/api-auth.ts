import { getUserSessionById, isSessionCurrent } from "@gumakart/auth";
import {
  getTenantStatusById,
  sellerWriteHttpRejectionForStatus,
} from "@gumakart/db";
import {
  can,
  canUseApi,
  shopRoleOf,
  type Permission,
  type ShopRole,
} from "@gumakart/db/staff-permissions";
import { headers } from "next/headers";
import { getSession, type Session } from "@/lib/session";

/**
 * Phase 10: the shop role is checked against the request path set by middleware
 * (x-guma-path / x-guma-method, always overwritten there). If they're missing,
 * staff are refused (owners are unaffected).
 */
async function requestPathAndMethod(): Promise<{ path: string; method: string } | null> {
  try {
    const h = await headers();
    const path = h.get("x-guma-path");
    const method = h.get("x-guma-method");
    return path && method ? { path, method } : null;
  } catch {
    return null;
  }
}

function forbiddenMessage(role: ShopRole): string {
  if (role === "cashier") return "Cashier accounts can only use the POS.";
  return "Your role can't do this. Ask the shop owner.";
}

export type RequireTenantSessionOptions = {
  /**
   * When true, suspended shops may still load session-backed reads (e.g. /api/shop)
   * so the seller console can show the suspended state. Write APIs leave this false.
   * Support-access sessions always bypass the write block so ops can help.
   */
  allowSuspended?: boolean;
};

export async function requireTenantSession(
  options: RequireTenantSessionOptions = {}
): Promise<
  Session & {
    tenantId: string;
    tenantSlug: string;
    tenantName: string;
    supportAccess: boolean;
    shopRole: ShopRole;
  }
> {
  const session = await getSession();
  if (!session) {
    throw new ApiAuthError("Not signed in.", 401);
  }

  const current = await isSessionCurrent(session.userId, session.sessionVersion);
  if (!current) {
    throw new ApiAuthError("Session expired. Please sign in again.", 401);
  }

  // Support access: JWT carries the target shop; users.tenant_id stays null for platform admins.
  if (session.supportAccess && session.role === "super_admin") {
    if (!session.tenantId || !session.tenantSlug) {
      throw new ApiAuthError("Support access session is missing shop context.", 403);
    }
    const tenantStatus = await getTenantStatusById(session.tenantId);
    if (tenantStatus == null) {
      throw new ApiAuthError("Shop not found for support access.", 404);
    }
    return {
      ...session,
      tenantId: session.tenantId,
      tenantSlug: session.tenantSlug,
      tenantName: session.tenantName ?? "",
      needsShopSetup: false,
      supportAccess: true,
      shopRole: "owner",
    };
  }

  // Trust the database over the JWT for tenant linkage — stale cookies are common
  // after shop setup or when a platform-admin session is reused on the seller app.
  const fresh = await getUserSessionById(session.userId);
  if (!fresh) {
    throw new ApiAuthError("Not signed in.", 401);
  }

  if (fresh.role === "super_admin" && !fresh.tenantId) {
    throw new ApiAuthError(
      "This platform admin account has no shop on the seller dashboard. Sign in with a seller account, or open a shop via Platform → Support access.",
      403,
      "PLATFORM_ADMIN_NO_TENANT"
    );
  }

  if (!fresh.tenantId || !fresh.tenantSlug) {
    throw new ApiAuthError(
      "Finish shop setup first — choose your shop name and URL to continue.",
      403,
      "SHOP_SETUP_REQUIRED"
    );
  }

  if (
    fresh.role !== "seller_owner" &&
    fresh.role !== "seller_staff" &&
    fresh.role !== "super_admin"
  ) {
    throw new ApiAuthError("This account cannot access the seller dashboard.", 403);
  }

  const shopRole = shopRoleOf(fresh);
  if (!shopRole) {
    throw new ApiAuthError("This staff account was removed from the shop.", 403, "STAFF_REMOVED");
  }
  if (shopRole !== "owner") {
    const req = await requestPathAndMethod();
    // Fail closed: without the middleware headers we can't tell what's being asked.
    if (!req || !canUseApi(shopRole, req.path, req.method)) {
      throw new ApiAuthError(forbiddenMessage(shopRole), 403, "ROLE_FORBIDDEN");
    }
  }

  const supportAccess = Boolean(session.supportAccess);
  if (!options.allowSuspended && !supportAccess) {
    const tenantStatus = await getTenantStatusById(fresh.tenantId);
    const rejection = sellerWriteHttpRejectionForStatus(tenantStatus);
    if (rejection) {
      throw new ApiAuthError(rejection.error, rejection.httpStatus, rejection.code);
    }
  }

  return {
    ...session,
    tenantId: fresh.tenantId,
    tenantSlug: fresh.tenantSlug,
    tenantName: fresh.tenantName ?? "",
    needsShopSetup: false,
    supportAccess,
    staffRole: fresh.staffRole ?? null,
    shopRole,
  };
}

/** For actions finer than a route (e.g. cancel inside the order PATCH). */
export function assertCan(session: { shopRole: ShopRole }, permission: Permission): void {
  if (!can(session.shopRole, permission)) {
    throw new ApiAuthError(forbiddenMessage(session.shopRole), 403, "ROLE_FORBIDDEN");
  }
}

export class ApiAuthError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}
