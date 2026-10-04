export {
  AUTH_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  EMAIL_VERIFY_MAX_AGE_SECONDS,
  SUPPORT_ACCESS_GRANT_MAX_AGE_SECONDS,
  SUPPORT_ACCESS_SESSION_MAX_AGE_SECONDS,
  type SessionUser,
  type SessionPayload,
  type RegisterSellerInput,
  type CompleteGoogleShopInput,
  type GoogleProfile,
  type LoginInput,
  AuthError,
} from "./types";

export {
  createSessionToken,
  createEmailVerificationToken,
  createSupportAccessGrantToken,
  verifySupportAccessGrantToken,
  verifySessionToken,
  verifyEmailToken,
  getSessionFromRequest,
  readSessionCookie,
  sessionCookieHeader,
  clearSessionCookieHeader,
  getSessionCookieOptions,
  type SupportAccessGrant,
} from "./session";

export {
  registerSeller,
  loginUser,
  verifyUserEmail,
  getUserSessionById,
  isSlugAvailable,
  sendVerificationEmail,
  isEmailRegistered,
  markUserEmailVerified,
  authenticateGoogleUser,
  completeGoogleShopSetup,
  revokeAllSessions,
  isSessionCurrent,
  normalizeSlug,
  slugFromShopName,
  validateSlug,
} from "./service";

export {
  createGoogleOAuthClient,
  getGoogleAuthUrl,
  getGoogleProfileFromCode,
  getGoogleRedirectUri,
  isGoogleAuthConfigured,
} from "./google";

export { hashPassword, verifyPassword, validatePasswordStrength } from "./password";

export {
  issueEmailCode,
  verifyEmailCode,
  createSignupTicket,
  readSignupTicket,
  verificationCodeEmail,
  normalizeCodeEmail,
  EMAIL_CODE_TTL_SECONDS,
  EMAIL_CODE_RESEND_SECONDS,
  type EmailCodePurpose,
} from "./email-code";
