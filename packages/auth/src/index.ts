export {
  AUTH_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  EMAIL_VERIFY_MAX_AGE_SECONDS,
  SUPPORT_ACCESS_GRANT_MAX_AGE_SECONDS,
  SUPPORT_ACCESS_SESSION_MAX_AGE_SECONDS,
  PARTNER_ACCESS_SESSION_MAX_AGE_SECONDS,
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
  type VerifiedSupportAccessGrant,
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
  registerPartnerUser,
  canResetPassword,
  resetPasswordWithCode,
  sessionTokenForUser,
  changePassword,
  signOutOtherDevices,
  revokeAllSessions,
  isSessionCurrent,
  normalizeSlug,
  slugFromShopName,
  findAvailableShopSlug,
  validateSlug,
} from "./service";

export {
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
export * from "./pos-token";
export * from "./buyer-token";

// Phase 21: two-step sign-in.
export { MFA_TICKET_MAX_AGE_SECONDS } from "./types";
export {
  MFA_TICKET_COOKIE,
  createMfaTicket,
  readMfaTicket,
  readMfaTicketCookie,
  mfaTicketCookieHeader,
  clearMfaTicketCookieHeader,
  getTwoFactorStatus,
  hasTwoFactor,
  beginTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
  verifySecondFactor,
  regenerateBackupCodes,
  disableTwoFactor,
  resetTwoFactor,
  ticketUserIsCurrent,
  type MfaApp,
  type MfaTicket,
  type MfaTicketKind,
  type TwoFactorStatus,
} from "./two-factor";
export { generateTotpSecret, totpCodeAt, totpStep, matchTotp, otpauthUri } from "./totp";
