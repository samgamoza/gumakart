import { and, asc, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "../client";
import { posStaff, staffInvites, tenants, users } from "../schema/index";
import { isStaffRole, STAFF_ROLES, type StaffRole } from "../types/staff-permissions";

export const STAFF_ROLE_VALUES = STAFF_ROLES;

/**
 * Phase 10 — staff accounts.
 *
 * One account belongs to one shop (users.tenant_id), as before. The owner invites
 * people by email; the invite is a single-use link (7 days) the owner can send by
 * email (when Resend is on) or paste into Messenger/SMS. Accepting it creates or
 * links the account as seller_staff with a staff_role.
 *
 * Removing someone keeps their row (so the activity log still names them) but sets
 * status = removed, clears staff_role and bumps session_version — every open session
 * stops working on the next request.
 */

export const INVITE_TTL_DAYS = 7;
export const MAX_STAFF = 25;

export class StaffError extends Error {
  constructor(
    message: string,
    public code:
      | "INVALID"
      | "ALREADY_MEMBER"
      | "OTHER_SHOP"
      | "LIMIT"
      | "NOT_FOUND"
      | "INVITE_EXPIRED"
      | "INVITE_USED"
      | "INVITE_REVOKED"
      | "EMAIL_MISMATCH"
      | "OWNER"
  ) {
    super(message);
    this.name = "StaffError";
  }
}

const normEmail = (e: string) => e.trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: "owner" | StaffRole;
  hasPin: boolean;
  createdAt: Date;
}

export interface PendingInvite {
  id: string;
  email: string;
  name: string | null;
  role: StaffRole;
  expiresAt: Date;
  expired: boolean;
  createdAt: Date;
}

export async function listTeam(tenantId: string): Promise<{ members: TeamMember[]; invites: PendingInvite[] }> {
  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      staffRole: users.staffRole,
      status: users.status,
      profile: users.profileJson,
      createdAt: users.createdAt,
      pinId: posStaff.id,
    })
    .from(users)
    .leftJoin(posStaff, and(eq(posStaff.userId, users.id), eq(posStaff.active, true)))
    .where(and(eq(users.tenantId, tenantId), ne(users.status, "removed")))
    .orderBy(asc(users.createdAt));

  const members: TeamMember[] = [];
  for (const r of rows) {
    const role = r.role === "seller_owner" ? "owner" : isStaffRole(r.staffRole) ? r.staffRole : null;
    if (!role) continue;
    members.push({
      userId: r.id,
      name: r.profile?.displayName ?? r.email ?? "Staff",
      email: r.email ?? "",
      role,
      hasPin: Boolean(r.pinId),
      createdAt: r.createdAt,
    });
  }
  members.sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));

  const now = new Date();
  const inviteRows = await db
    .select()
    .from(staffInvites)
    .where(and(eq(staffInvites.tenantId, tenantId), isNull(staffInvites.acceptedAt), isNull(staffInvites.revokedAt)))
    .orderBy(desc(staffInvites.createdAt))
    .limit(50);
  const invites = inviteRows.map((i) => ({
    id: i.id,
    email: i.email,
    name: i.name,
    role: i.staffRole,
    expiresAt: i.expiresAt,
    expired: i.expiresAt <= now,
    createdAt: i.createdAt,
  }));
  return { members, invites };
}

/** Creates an invite and returns the one-time token (only its hash is stored). */
export async function createStaffInvite(
  tenantId: string,
  input: { email: string; name?: string | null; role: StaffRole },
  invitedBy: string | null
): Promise<{ invite: PendingInvite; token: string }> {
  const email = normEmail(input.email);
  if (!EMAIL_RE.test(email) || email.length > 255) throw new StaffError("Enter a valid email address.", "INVALID");
  if (!isStaffRole(input.role)) throw new StaffError("Pick a role.", "INVALID");
  const name = input.name?.trim().slice(0, 80) || null;

  const db = getDb();
  return db.transaction(async (tx) => {
    // Serialise invites per shop so the staff limit can't be raced.
    await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).for("update");

    const [existing] = await tx
      .select({ id: users.id, tenantId: users.tenantId, role: users.role, status: users.status, staffRole: users.staffRole })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (existing) {
      const activeHere = existing.tenantId === tenantId && existing.status !== "removed" && (existing.role === "seller_owner" || existing.staffRole);
      if (activeHere) throw new StaffError("This person is already on your team.", "ALREADY_MEMBER");
      const elsewhere = existing.tenantId && existing.tenantId !== tenantId && existing.status !== "removed";
      if (elsewhere || existing.role === "super_admin") {
        throw new StaffError("This email already runs or works in another shop. Use a different email.", "OTHER_SHOP");
      }
    }

    const [{ count }] = (await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "seller_staff"), ne(users.status, "removed")))) as [
      { count: number },
    ];
    if (count >= MAX_STAFF) throw new StaffError(`Up to ${MAX_STAFF} staff per shop.`, "LIMIT");

    // A new invite replaces any open one for the same email.
    await tx
      .update(staffInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(staffInvites.tenantId, tenantId),
          eq(staffInvites.email, email),
          isNull(staffInvites.acceptedAt),
          isNull(staffInvites.revokedAt)
        )
      );

    const token = newToken();
    const [row] = await tx
      .insert(staffInvites)
      .values({
        tenantId,
        email,
        name,
        staffRole: input.role,
        tokenHash: await sha256Hex(token),
        invitedBy,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      })
      .returning();
    return {
      token,
      invite: {
        id: row!.id,
        email: row!.email,
        name: row!.name,
        role: row!.staffRole,
        expiresAt: row!.expiresAt,
        expired: false,
        createdAt: row!.createdAt,
      },
    };
  });
}

export async function revokeStaffInvite(tenantId: string, inviteId: string): Promise<boolean> {
  const rows = await getDb()
    .update(staffInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(staffInvites.id, inviteId), eq(staffInvites.tenantId, tenantId), isNull(staffInvites.acceptedAt)))
    .returning({ id: staffInvites.id });
  return rows.length > 0;
}

export interface InviteView {
  email: string;
  name: string | null;
  role: StaffRole;
  shopName: string;
  /** An account with this email exists — the invitee signs in with its password. */
  hasAccount: boolean;
  status: "valid" | "expired" | "used" | "revoked";
}

async function inviteByToken(token: string) {
  if (!token || token.length > 100) return null;
  const [row] = await getDb()
    .select({ invite: staffInvites, shopName: tenants.name })
    .from(staffInvites)
    .innerJoin(tenants, eq(tenants.id, staffInvites.tenantId))
    .where(eq(staffInvites.tokenHash, await sha256Hex(token)))
    .limit(1);
  return row ?? null;
}

export async function getStaffInvite(token: string): Promise<InviteView | null> {
  const row = await inviteByToken(token);
  if (!row) return null;
  const [account] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${row.invite.email}`)
    .limit(1);
  const i = row.invite;
  return {
    email: i.email,
    name: i.name,
    role: i.staffRole,
    shopName: row.shopName,
    hasAccount: Boolean(account),
    status: i.revokedAt ? "revoked" : i.acceptedAt ? "used" : i.expiresAt <= new Date() ? "expired" : "valid",
  };
}

/**
 * Accepts an invite. Pass `passwordHash` + `name` for a new account, or `existingUserId`
 * (already password-checked by the caller) for an account that has this email.
 * Returns the user id to sign in.
 */
export async function acceptStaffInvite(input: {
  token: string;
  name: string;
  passwordHash?: string;
  existingUserId?: string;
}): Promise<{ userId: string; tenantId: string; role: StaffRole }> {
  const row = await inviteByToken(input.token);
  if (!row) throw new StaffError("This invite link isn't valid.", "NOT_FOUND");
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new StaffError("Enter your name.", "INVALID");

  return getDb().transaction(async (tx) => {
    const [invite] = await tx.select().from(staffInvites).where(eq(staffInvites.id, row.invite.id)).for("update");
    if (!invite) throw new StaffError("This invite link isn't valid.", "NOT_FOUND");
    if (invite.revokedAt) throw new StaffError("This invite was cancelled. Ask the owner for a new one.", "INVITE_REVOKED");
    if (invite.acceptedAt) throw new StaffError("This invite was already used. Sign in instead.", "INVITE_USED");
    if (invite.expiresAt <= new Date()) throw new StaffError("This invite expired. Ask the owner for a new one.", "INVITE_EXPIRED");

    const [existing] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${invite.email}`)
      .for("update")
      .limit(1);

    let userId: string;
    const profile = { ...(existing?.profileJson ?? {}), displayName: name };
    if (existing) {
      if (input.existingUserId !== existing.id) {
        throw new StaffError("Sign in with the account for this email to accept.", "EMAIL_MISMATCH");
      }
      if (existing.role === "super_admin" || (existing.role === "seller_owner" && existing.tenantId)) {
        throw new StaffError("This email already runs a shop. Use a different email.", "OTHER_SHOP");
      }
      if (existing.tenantId && existing.tenantId !== invite.tenantId && existing.status !== "removed") {
        throw new StaffError("This email already works in another shop.", "OTHER_SHOP");
      }
      await tx
        .update(users)
        .set({
          role: "seller_staff",
          staffRole: invite.staffRole,
          tenantId: invite.tenantId,
          status: "active",
          profileJson: profile,
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
          sessionVersion: sql`${users.sessionVersion} + 1`,
        })
        .where(eq(users.id, existing.id));
      userId = existing.id;
    } else {
      if (!input.passwordHash) throw new StaffError("Choose a password.", "INVALID");
      const [created] = await tx
        .insert(users)
        .values({
          email: invite.email,
          passwordHash: input.passwordHash,
          role: "seller_staff",
          staffRole: invite.staffRole,
          tenantId: invite.tenantId,
          status: "active",
          profileJson: profile,
          // The owner sent this single-use link to this address/person.
          emailVerifiedAt: new Date(),
        })
        .returning({ id: users.id });
      userId = created!.id;
    }

    await tx
      .update(staffInvites)
      .set({ acceptedAt: new Date(), acceptedUserId: userId })
      .where(eq(staffInvites.id, invite.id));
    return { userId, tenantId: invite.tenantId, role: invite.staffRole };
  });
}

async function staffRow(tenantId: string, userId: string) {
  const [u] = await getDb()
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
    .limit(1);
  if (!u || u.status === "removed") throw new StaffError("Staff member not found.", "NOT_FOUND");
  if (u.role === "seller_owner") throw new StaffError("The owner's role can't be changed here.", "OWNER");
  if (u.role !== "seller_staff") throw new StaffError("Staff member not found.", "NOT_FOUND");
  return u;
}

/** Changes a role. Signs the person out everywhere so the new role applies at once. */
export async function changeStaffRole(tenantId: string, userId: string, role: StaffRole): Promise<{ from: string | null }> {
  if (!isStaffRole(role)) throw new StaffError("Pick a role.", "INVALID");
  const u = await staffRow(tenantId, userId);
  await getDb()
    .update(users)
    .set({ staffRole: role, sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, u.id));
  // A PIN keeps working; its POS role follows the account.
  await getDb()
    .update(posStaff)
    .set({ role: role === "manager" ? "manager" : "cashier" })
    .where(and(eq(posStaff.userId, u.id), eq(posStaff.tenantId, tenantId)));
  return { from: u.staffRole ?? null };
}

/** Removes someone from the shop: signed out everywhere, PIN turned off, history kept. */
export async function removeStaff(tenantId: string, userId: string): Promise<{ name: string }> {
  const u = await staffRow(tenantId, userId);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ status: "removed", staffRole: null, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, u.id));
    await tx
      .update(posStaff)
      .set({ active: false, pinVersion: sql`${posStaff.pinVersion} + 1` })
      .where(and(eq(posStaff.userId, u.id), eq(posStaff.tenantId, tenantId)));
  });
  return { name: u.profileJson?.displayName ?? u.email ?? "Staff" };
}

/** Staff whose account matches a name, for the PIN screen link (ids only). */
export async function posStaffIdForUser(tenantId: string, userId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: posStaff.id })
    .from(posStaff)
    .where(and(eq(posStaff.tenantId, tenantId), eq(posStaff.userId, userId), eq(posStaff.active, true)))
    .limit(1);
  return row?.id ?? null;
}

/** Live invites for a shop, oldest first (used by tests and the cleanup cron later). */
export async function countOpenInvites(tenantId: string): Promise<number> {
  const [r] = (await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(staffInvites)
    .where(
      and(
        eq(staffInvites.tenantId, tenantId),
        isNull(staffInvites.acceptedAt),
        isNull(staffInvites.revokedAt),
        gt(staffInvites.expiresAt, new Date())
      )
    )) as [{ n: number }];
  return r.n;
}


/**
 * POS quick unlock for a staff account: creates or replaces the PIN linked to the
 * account (name and POS role follow the account). Owner PINs aren't needed — the
 * owner's own session opens the register.
 */
export async function setStaffPin(tenantId: string, userId: string, pinHash: string): Promise<{ posStaffId: string }> {
  const u = await staffRow(tenantId, userId);
  const name = (u.profileJson?.displayName ?? u.email ?? "Staff").trim().replace(/\s+/g, " ").slice(0, 60);
  const role = u.staffRole === "manager" ? "manager" : "cashier";
  const db = getDb();
  return db.transaction(async (tx) => {
    const [linked] = await tx
      .select({ id: posStaff.id })
      .from(posStaff)
      .where(and(eq(posStaff.tenantId, tenantId), eq(posStaff.userId, u.id)))
      .for("update")
      .limit(1);
    if (linked) {
      await tx
        .update(posStaff)
        .set({ pinHash, role, name, active: true, failedAttempts: 0, lockedUntil: null, pinVersion: sql`${posStaff.pinVersion} + 1` })
        .where(eq(posStaff.id, linked.id));
      return { posStaffId: linked.id };
    }
    // Names are unique on the PIN screen; add a suffix when a PIN-only cashier has it.
    let finalName = name;
    for (let n = 2; n < 50; n++) {
      const [dupe] = await tx
        .select({ id: posStaff.id })
        .from(posStaff)
        .where(and(eq(posStaff.tenantId, tenantId), sql`lower(${posStaff.name}) = lower(${finalName})`))
        .limit(1);
      if (!dupe) break;
      finalName = `${name.slice(0, 56)} ${n}`;
    }
    const [row] = await tx
      .insert(posStaff)
      .values({ tenantId, name: finalName, role, pinHash, userId: u.id })
      .returning({ id: posStaff.id });
    return { posStaffId: row!.id };
  });
}

/** For accepting an invite with an existing account: id + password hash by email. */
export async function getInviteAccount(email: string): Promise<{ id: string; passwordHash: string | null } | null> {
  const [u] = await getDb()
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(sql`lower(${users.email}) = ${normEmail(email)}`)
    .limit(1);
  return u ?? null;
}
