import { eq, sql } from "drizzle-orm";
import {
  getDb,
  needsGumaLaunch,
  tenants,
  users,
} from "@gumakart/db";
import { deriveBrandKit, buildStoreDNA } from "@gumakart/storefront-themes";
import { hashPassword, validatePasswordStrength, verifyPassword } from "./password";
import {
  createEmailVerificationToken,
  createSessionToken,
  verifyEmailToken,
} from "./session";
import { normalizeSlug, slugFromShopName, validateSlug } from "./slug";
import {
  AuthError,
  type CompleteGoogleShopInput,
  type GoogleProfile,
  type LoginInput,
  type RegisterSellerInput,
  type SessionUser,
} from "./types";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizePhone(phone?: string): string | undefined {
  if (!phone?.trim()) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.length === 10) return `+63${digits}`;
  return phone.trim();
}

function seedTenantTheme(input: {
  shopName: string;
  shopSlug: string;
  category?: string;
  vibe?: string;
}) {
  const brandKit = deriveBrandKit({
    shopName: input.shopName,
    slug: input.shopSlug,
    category: input.category,
    vibe: input.vibe,
    subscriptionPlan: "free",
  });

  const storeDna = buildStoreDNA({
    businessName: input.shopName,
    category: input.category,
    vibe: brandKit.vibe,
    locale: "taglish",
    launchStep: "dna",
    goals: ["launch_fast"],
    sellingChannels: ["social"],
  });

  return {
    themeDraft: brandKit,
    storeDna,
  };
}

function toSessionUser(
  user: typeof users.$inferSelect,
  tenant: typeof tenants.$inferSelect | null | undefined
): SessionUser {
  return {
    userId: user.id,
    email: user.email ?? "",
    role: user.role,
    staffRole: user.role === "seller_staff" ? (user.staffRole ?? null) : null,
    tenantId: tenant?.id ?? null,
    tenantSlug: tenant?.slug ?? null,
    tenantName: tenant?.name ?? null,
    displayName: user.profileJson?.displayName ?? user.email ?? "Seller",
    emailVerified: Boolean(user.emailVerifiedAt),
    // Phase 18: partners have no shop of their own — never send them to shop setup.
    needsShopSetup: user.role === "partner" ? false : !tenant,
    sessionVersion: user.sessionVersion ?? 0,
  };
}

/**
 * Invalidates every session for this user by bumping their session version.
 * Tokens issued before the bump fail the isSessionCurrent check.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId));
}

/** True when the token's session version matches the user's current one. */
export async function isSessionCurrent(
  userId: string,
  tokenSessionVersion: number
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return false;
  return (row.sessionVersion ?? 0) === tokenSessionVersion;
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  const validation = validateSlug(slug);
  if (!validation.ok) return false;

  const db = getDb();
  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);

  return existing.length === 0;
}

/**
 * Plan §9: the shop URL is generated from the name, not asked for. Returns the
 * name's slug, or the first free "-2", "-3"… variant, or a random suffix.
 */
export async function findAvailableShopSlug(shopName: string): Promise<string> {
  let base = slugFromShopName(shopName).replace(/-+$/g, "");
  if (base.length < 3 || !validateSlug(base).ok) base = `shop-${base}`.replace(/-+$/g, "").slice(0, 24);
  if (base.length < 3) base = "shop";
  base = base.slice(0, 26).replace(/-+$/g, "");
  const db = getDb();
  const candidates = [base, ...Array.from({ length: 8 }, (_, i) => `${base}-${i + 2}`)];
  for (const candidate of candidates) {
    if (!validateSlug(candidate).ok) continue;
    const [taken] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, candidate)).limit(1);
    if (!taken) return candidate;
  }
  for (let i = 0; i < 5; i++) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const [taken] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, candidate)).limit(1);
    if (!taken && validateSlug(candidate).ok) return candidate;
  }
  throw new AuthError("Couldn't pick a shop URL. Try a slightly different shop name.", "SLUG_TAKEN");
}

export async function registerSeller(input: RegisterSellerInput): Promise<{
  user: SessionUser;
  sessionToken: string;
  verificationToken: string;
}> {
  const email = normalizeEmail(input.email);
  const shopSlug = input.shopSlug?.trim()
    ? normalizeSlug(input.shopSlug)
    : await findAvailableShopSlug(input.shopName);
  const passwordCheck = validatePasswordStrength(input.password);
  if (!passwordCheck.ok) {
    throw new AuthError(passwordCheck.reason, "WEAK_PASSWORD");
  }

  const slugCheck = validateSlug(shopSlug);
  if (!slugCheck.ok) {
    throw new AuthError(slugCheck.reason, "SLUG_INVALID");
  }

  const db = getDb();

  const existingEmail = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existingEmail.length > 0) {
    throw new AuthError("An account with this email already exists.", "EMAIL_TAKEN");
  }

  const existingSlug = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, shopSlug))
    .limit(1);
  if (existingSlug.length > 0) {
    throw new AuthError("This shop URL is already taken.", "SLUG_TAKEN");
  }

  const passwordHash = await hashPassword(input.password);

  const { themeDraft, storeDna } = seedTenantTheme({
    shopName: input.shopName,
    shopSlug,
    category: input.category,
    vibe: input.vibe,
  });

  const result = await db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({
        slug: shopSlug,
        name: input.shopName.trim(),
        category: input.category?.trim() || "General",
        themeJson: themeDraft,
        themeDraftJson: themeDraft,
        storeDnaJson: storeDna,
        localeDefault: "taglish",
        settingsJson: { codEnabled: true, autoAcceptOrders: false, minOrderAmount: 99 },
        subscriptionPlan: "free",
        status: "pending",
      })
      .returning();

    if (!tenant) throw new Error("Failed to create shop");

    const [user] = await tx
      .insert(users)
      .values({
        email,
        passwordHash,
        role: "seller_owner",
        tenantId: tenant.id,
        profileJson: { displayName: input.displayName.trim() },
        emailVerifiedAt: input.emailVerified ? new Date() : null,
      })
      .returning();

    if (!user) throw new Error("Failed to create user");

    return { user, tenant };
  });

  const { user, tenant } = result;

  const sessionUser = toSessionUser(user, tenant);
  const sessionToken = await createSessionToken(sessionUser);
  const verificationToken = await createEmailVerificationToken(user.id, email);

  return { user: sessionUser, sessionToken, verificationToken };
}

export async function loginUser(input: LoginInput): Promise<{
  user: SessionUser;
  sessionToken: string;
}> {
  const email = normalizeEmail(input.email);
  const db = getDb();

  // Phase 18: partners sign in without a shop; everyone else still needs one.
  const [row] = await db
    .select({ user: users, tenant: tenants })
    .from(users)
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.email, email))
    .limit(1);

  if (!row || (!row.tenant && row.user.role !== "partner")) {
    throw new AuthError("Invalid email or password.", "INVALID_CREDENTIALS");
  }

  if (!row.user.passwordHash) {
    throw new AuthError("Sign in with Google for this account.", "USE_GOOGLE");
  }

  const valid = await verifyPassword(input.password, row.user.passwordHash);
  if (!valid) {
    throw new AuthError("Invalid email or password.", "INVALID_CREDENTIALS");
  }

  if (row.user.role !== "seller_owner" && row.user.role !== "seller_staff" && row.user.role !== "partner") {
    throw new AuthError("This account cannot access the seller dashboard.", "INVALID_CREDENTIALS");
  }

  // User-level suspend blocks login entirely. Tenant-level suspend allows login
  // so the seller console can show "Your shop is suspended — contact support".
  if (row.user.status === "suspended") {
    throw new AuthError(
      "This account is suspended. Contact support for help.",
      "ACCOUNT_SUSPENDED"
    );
  }
  // Phase 10: a staff member the owner removed keeps their row (activity history) but can't sign in.
  if (row.user.status === "removed" || (row.user.role === "seller_staff" && (!row.user.tenantId || !row.user.staffRole))) {
    throw new AuthError("This staff account was removed from the shop. Ask the owner for a new invite.", "ACCOUNT_REMOVED");
  }

  const sessionUser = toSessionUser(row.user, row.tenant);
  const sessionToken = await createSessionToken(sessionUser);

  return { user: sessionUser, sessionToken };
}

/** True when an account already uses this email (any role). */
export async function isEmailRegistered(rawEmail: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizeEmail(rawEmail)))
    .limit(1);
  return rows.length > 0;
}

/** Marks the user's current email as verified (after a correct emailed code). */
export async function markUserEmailVerified(userId: string): Promise<SessionUser | null> {
  const db = getDb();
  const [updated] = await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) return null;
  return getUserSessionById(updated.id);
}

export async function verifyUserEmail(token: string): Promise<SessionUser | null> {
  const payload = await verifyEmailToken(token);
  if (!payload) return null;

  const db = getDb();
  const [row] = await db
    .select({ user: users, tenant: tenants })
    .from(users)
    .innerJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.id, payload.userId))
    .limit(1);

  if (!row || row.user.email !== payload.email) return null;

  const [updated] = await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, row.user.id))
    .returning();

  if (!updated) return null;

  return toSessionUser(updated, row.tenant);
}

async function findUserWithTenant(email: string) {
  const db = getDb();
  const [row] = await db
    .select({ user: users, tenant: tenants })
    .from(users)
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.email, email))
    .limit(1);

  return row ?? null;
}

export async function authenticateGoogleUser(profile: GoogleProfile): Promise<{
  user: SessionUser;
  sessionToken: string;
  redirectTo: string;
}> {
  const db = getDb();
  const existing = await findUserWithTenant(profile.email);

  if (existing) {
    const { user, tenant } = existing;

    if (user.passwordHash && !user.profileJson?.googleId) {
      throw new AuthError(
        "An account with this email already exists. Sign in with your password instead.",
        "EMAIL_TAKEN"
      );
    }

    if (user.profileJson?.googleId && user.profileJson.googleId !== profile.googleId) {
      throw new AuthError("This Google account does not match our records.", "INVALID_CREDENTIALS");
    }

    const [updated] = await db
      .update(users)
      .set({
        profileJson: {
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          googleId: profile.googleId,
        },
        emailVerifiedAt: profile.emailVerified ? new Date() : user.emailVerifiedAt,
      })
      .where(eq(users.id, user.id))
      .returning();

    if (!updated) throw new Error("Failed to update Google user");

    const sessionUser = toSessionUser(updated, tenant);
    const sessionToken = await createSessionToken(sessionUser);

    const redirectTo = sessionUser.needsShopSetup
      ? "/signup/shop"
      : needsGumaLaunch(tenant)
        ? "/launch"
        : "/";

    return {
      user: sessionUser,
      sessionToken,
      redirectTo,
    };
  }

  const [created] = await db
    .insert(users)
    .values({
      email: profile.email,
      role: "seller_owner",
      emailVerifiedAt: profile.emailVerified ? new Date() : null,
      profileJson: {
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        googleId: profile.googleId,
      },
    })
    .returning();

  if (!created) throw new Error("Failed to create Google user");

  const sessionUser = toSessionUser(created, null);
  const sessionToken = await createSessionToken(sessionUser);

  return {
    user: sessionUser,
    sessionToken,
    redirectTo: "/signup/shop",
  };
}

export async function completeGoogleShopSetup(input: CompleteGoogleShopInput): Promise<{
  user: SessionUser;
  sessionToken: string;
}> {
  const shopSlug = input.shopSlug?.trim()
    ? normalizeSlug(input.shopSlug)
    : await findAvailableShopSlug(input.shopName);
  const slugCheck = validateSlug(shopSlug);
  if (!slugCheck.ok) {
    throw new AuthError(slugCheck.reason, "SLUG_INVALID");
  }

  const db = getDb();

  const [existingUser] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!existingUser) {
    throw new AuthError("User not found.", "USER_NOT_FOUND");
  }
  if (existingUser.tenantId) {
    throw new AuthError("Shop is already set up.", "SHOP_ALREADY_SETUP");
  }
  if (!existingUser.profileJson?.googleId) {
    throw new AuthError("Complete Google sign-in first.", "VALIDATION");
  }

  const existingSlug = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, shopSlug))
    .limit(1);
  if (existingSlug.length > 0) {
    throw new AuthError("This shop URL is already taken.", "SLUG_TAKEN");
  }

  const { themeDraft, storeDna } = seedTenantTheme({
    shopName: input.shopName,
    shopSlug,
    category: input.category,
    vibe: input.vibe,
  });

  const result = await db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({
        slug: shopSlug,
        name: input.shopName.trim(),
        category: input.category?.trim() || "General",
        themeJson: themeDraft,
        themeDraftJson: themeDraft,
        storeDnaJson: storeDna,
        localeDefault: "taglish",
        settingsJson: { codEnabled: true, autoAcceptOrders: false, minOrderAmount: 99 },
        subscriptionPlan: "free",
        status: "pending",
      })
      .returning();

    if (!tenant) throw new Error("Failed to create shop");

    const [updatedUser] = await tx
      .update(users)
      .set({ tenantId: tenant.id })
      .where(eq(users.id, existingUser.id))
      .returning();

    if (!updatedUser) throw new Error("Failed to link shop to user");

    return { user: updatedUser, tenant };
  });

  const sessionUser = toSessionUser(result.user, result.tenant);
  const sessionToken = await createSessionToken(sessionUser);

  return { user: sessionUser, sessionToken };
}

/** Phase 18: a partner account (no shop). The partners row is created by @gumakart/db. */
export async function registerPartnerUser(input: {
  email: string;
  password: string;
  displayName: string;
  emailVerified?: boolean;
}): Promise<{ userId: string }> {
  const email = normalizeEmail(input.email);
  const passwordCheck = validatePasswordStrength(input.password);
  if (!passwordCheck.ok) throw new AuthError(passwordCheck.reason, "WEAK_PASSWORD");
  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new AuthError("An account with this email already exists.", "EMAIL_TAKEN");
  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      role: "partner",
      tenantId: null,
      profileJson: { displayName: input.displayName.trim() },
      emailVerifiedAt: input.emailVerified ? new Date() : null,
    })
    .returning({ id: users.id });
  if (!user) throw new Error("Failed to create partner user");
  return { userId: user.id };
}

/** Phase 18: a session token for a user as stored (used to leave partner mode). */
export async function sessionTokenForUser(userId: string): Promise<{ user: SessionUser; sessionToken: string } | null> {
  const user = await getUserSessionById(userId);
  if (!user) return null;
  return { user, sessionToken: await createSessionToken(user) };
}

export async function getUserSessionById(userId: string): Promise<SessionUser | null> {
  const db = getDb();
  const [row] = await db
    .select({ user: users, tenant: tenants })
    .from(users)
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;
  return toSessionUser(row.user, row.tenant);
}

export async function sendVerificationEmail(
  email: string,
  verificationToken: string
): Promise<void> {
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";
  const verifyUrl = `${adminUrl}/verify-email?token=${encodeURIComponent(verificationToken)}`;

  if (process.env.RESEND_API_KEY) {
    // Placeholder for future Resend integration
    console.log(`[auth] Verification email for ${email}: ${verifyUrl}`);
    return;
  }

  console.log(`[auth] Verify your Guma One email (${email}): ${verifyUrl}`);
}

export { normalizeSlug, slugFromShopName, validateSlug };
