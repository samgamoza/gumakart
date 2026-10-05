export const AUTH_COOKIE_NAME = "gumakart_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
export const EMAIL_VERIFY_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours
/** One-time grant exchanged on admin host for a support session. */
export const SUPPORT_ACCESS_GRANT_MAX_AGE_SECONDS = 60 * 5;
/** How long ops may stay in a shop via Support access. */
export const SUPPORT_ACCESS_SESSION_MAX_AGE_SECONDS = 60 * 60 * 2;

export interface SessionUser {
  userId: string;
  email: string;
  role: string;
  /** Phase 10: manager | staff | cashier for role = seller_staff; null otherwise. */
  staffRole?: string | null;
  tenantId: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
  displayName: string;
  emailVerified: boolean;
  needsShopSetup: boolean;
  /** Mirrors users.session_version; tokens with an older value are revoked. */
  sessionVersion: number;
  /**
   * Super-admin viewing/acting as a shop (tenant fields come from JWT, not users.tenant_id).
   * Cookie is host-scoped to admin.*; platform cookie on ops.* stays separate.
   */
  supportAccess?: boolean;
}

export interface SessionPayload extends SessionUser {
  iat: number;
  exp: number;
}

export interface RegisterSellerInput {
  email: string;
  password: string;
  displayName: string;
  shopName: string;
  /** Optional: generated from the shop name when left out (plan §9). */
  shopSlug?: string;
  category?: string;
  /** Brand vibe chosen at signup — seeds a unique starting theme. */
  vibe?: string;
  /** Set when the email was already proven (signup code); stamps email_verified_at. */
  emailVerified?: boolean;
}

export interface CompleteGoogleShopInput {
  userId: string;
  shopName: string;
  /** Optional: generated from the shop name when left out (plan §9). */
  shopSlug?: string;
  category?: string;
  /** Brand vibe chosen at signup — seeds a unique starting theme. */
  vibe?: string;
}

export interface GoogleProfile {
  googleId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  emailVerified: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public code:
      | "INVALID_CREDENTIALS"
      | "EMAIL_TAKEN"
      | "SLUG_TAKEN"
      | "SLUG_INVALID"
      | "WEAK_PASSWORD"
      | "USER_NOT_FOUND"
      | "INVALID_TOKEN"
      | "VALIDATION"
      | "USE_GOOGLE"
      | "SHOP_ALREADY_SETUP"
      | "ACCOUNT_SUSPENDED"
      | "ACCOUNT_REMOVED"
      | "CODE_COOLDOWN"
      | "CODE_EXPIRED"
      | "CODE_INVALID"
      | "CODE_LOCKED"
  ) {
    super(message);
    this.name = "AuthError";
  }
}
