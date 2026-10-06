/**
 * Phase 18 — agency partner program (no commission yet; referrals are recorded for later).
 *
 * - A partner has its own login (users.role = 'partner', no shop). Ops approves it (status active).
 * - A shop owner grants an active partner access by its code, as Manager or Staff. One partner with
 *   access per shop at a time. The owner can revoke any time; every API call re-checks the grant.
 * - Shops that sign up through a partner's link are recorded as referrals (no access by itself).
 * - Partners see dashboards only for shops that granted access; referral-only shops show just the
 *   name and sign-up date (the owner hasn't agreed to share anything else).
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "../client";
import { orders, partnerShops, partners, tenants, users } from "../schema/index";

export type PartnerStatus = "pending" | "active" | "suspended";
export type PartnerAccessRole = "manager" | "staff";

export class PartnerError extends Error {
  constructor(
    public code: "NOT_FOUND" | "INVALID" | "INACTIVE" | "TAKEN" | "FORBIDDEN",
    message: string
  ) {
    super(message);
    this.name = "PartnerError";
  }
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newPartnerCode(): string {
  const bytes = randomBytes(6);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `P-${out}`;
}

/** "p-abc234", "P ABC234", "abc234" → "P-ABC234" (or null). */
export function normalizePartnerCode(raw: string | null | undefined): string | null {
  const s = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = s.startsWith("P") && s.length === 7 ? s.slice(1) : s;
  if (!/^[A-Z0-9]{6}$/.test(body)) return null;
  return `P-${body}`;
}

export interface PartnerRow {
  id: string;
  userId: string;
  name: string;
  code: string;
  contactEmail: string;
  phone: string | null;
  website: string | null;
  city: string | null;
  about: string | null;
  status: PartnerStatus;
  statusNote: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

function toRow(p: typeof partners.$inferSelect): PartnerRow {
  return {
    id: p.id,
    userId: p.userId,
    name: p.name,
    code: p.code,
    contactEmail: p.contactEmail,
    phone: p.phone,
    website: p.website,
    city: p.city,
    about: p.about,
    status: p.status,
    statusNote: p.statusNote,
    approvedAt: p.approvedAt,
    createdAt: p.createdAt,
  };
}

const clean = (v: string | null | undefined, max: number) => (v ?? "").trim().slice(0, max) || null;

/** Called right after the partner's user is created. */
export async function createPartnerProfile(input: {
  userId: string;
  name: string;
  contactEmail: string;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
  about?: string | null;
}): Promise<PartnerRow> {
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new PartnerError("INVALID", "Enter your agency or business name.");
  const db = getDb();
  for (let i = 0; i < 5; i++) {
    const [row] = await db
      .insert(partners)
      .values({
        userId: input.userId,
        name,
        code: newPartnerCode(),
        contactEmail: input.contactEmail.trim().toLowerCase().slice(0, 255),
        phone: clean(input.phone, 20),
        website: clean(input.website, 255),
        city: clean(input.city, 120),
        about: clean(input.about, 500),
      })
      .onConflictDoNothing()
      .returning();
    if (row) return toRow(row);
  }
  throw new Error("Could not make a unique partner code.");
}

export async function getPartnerForUser(userId: string): Promise<PartnerRow | null> {
  const [p] = await getDb().select().from(partners).where(eq(partners.userId, userId)).limit(1);
  return p ? toRow(p) : null;
}

export async function updatePartnerProfile(
  userId: string,
  patch: { name?: string; phone?: string | null; website?: string | null; city?: string | null; about?: string | null }
): Promise<PartnerRow> {
  const set: Partial<typeof partners.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 120);
    if (name.length < 2) throw new PartnerError("INVALID", "Enter your agency or business name.");
    set.name = name;
  }
  if (patch.phone !== undefined) set.phone = clean(patch.phone, 20);
  if (patch.website !== undefined) set.website = clean(patch.website, 255);
  if (patch.city !== undefined) set.city = clean(patch.city, 120);
  if (patch.about !== undefined) set.about = clean(patch.about, 500);
  const [p] = await getDb().update(partners).set(set).where(eq(partners.userId, userId)).returning();
  if (!p) throw new PartnerError("NOT_FOUND", "Partner profile not found.");
  return toRow(p);
}

/** Public: who is this code? (signup banner, owner's "add partner" preview). */
export async function lookupPartnerCode(rawCode: string): Promise<{ id: string; name: string; code: string; status: PartnerStatus; city: string | null; website: string | null } | null> {
  const code = normalizePartnerCode(rawCode);
  if (!code) return null;
  const [p] = await getDb()
    .select({ id: partners.id, name: partners.name, code: partners.code, status: partners.status, city: partners.city, website: partners.website })
    .from(partners)
    .where(eq(partners.code, code))
    .limit(1);
  return p ?? null;
}

/** Seller signup through a partner link. Never fails the signup — a bad code is just ignored. */
export async function recordPartnerReferral(tenantId: string, rawCode: string | null | undefined): Promise<boolean> {
  if (!rawCode) return false;
  const p = await lookupPartnerCode(rawCode);
  if (!p || p.status === "suspended") return false;
  const db = getDb();
  return db.transaction(async (tx) => {
    const [t] = await tx
      .update(tenants)
      .set({ referredByPartnerId: p.id })
      .where(and(eq(tenants.id, tenantId), isNull(tenants.referredByPartnerId)))
      .returning({ id: tenants.id });
    if (!t) return false;
    await tx.insert(partnerShops).values({ partnerId: p.id, tenantId, source: "referral" }).onConflictDoNothing();
    return true;
  });
}

export interface ShopPartnerView {
  /** The partner with access now (null = none). */
  access: { partnerId: string; name: string; code: string; role: PartnerAccessRole; grantedAt: Date | null; lastOpenedAt: Date | null; contactEmail: string; website: string | null } | null;
  /** The partner whose link this shop signed up through. */
  referredBy: { partnerId: string; name: string; code: string; status: PartnerStatus } | null;
}

/** Owner's Settings → Partner. */
export async function getShopPartner(tenantId: string): Promise<ShopPartnerView> {
  const db = getDb();
  const [active] = await db
    .select({
      partnerId: partners.id,
      name: partners.name,
      code: partners.code,
      role: partnerShops.accessRole,
      grantedAt: partnerShops.grantedAt,
      lastOpenedAt: partnerShops.lastOpenedAt,
      contactEmail: partners.contactEmail,
      website: partners.website,
    })
    .from(partnerShops)
    .innerJoin(partners, eq(partners.id, partnerShops.partnerId))
    .where(and(eq(partnerShops.tenantId, tenantId), isNotNull(partnerShops.accessRole), isNull(partnerShops.revokedAt)))
    .limit(1);
  const [ref] = await db
    .select({ partnerId: partners.id, name: partners.name, code: partners.code, status: partners.status })
    .from(tenants)
    .innerJoin(partners, eq(partners.id, tenants.referredByPartnerId))
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return {
    access: active ? { ...active, role: active.role as PartnerAccessRole } : null,
    referredBy: ref ?? null,
  };
}

/** Owner gives a partner access (or changes its role). */
export async function grantPartnerAccess(input: {
  tenantId: string;
  code: string;
  role: PartnerAccessRole;
  ownerUserId: string;
}): Promise<{ partnerId: string; name: string; contactEmail: string; changed: boolean }> {
  if (input.role !== "manager" && input.role !== "staff") throw new PartnerError("INVALID", "Pick Manager or Staff.");
  const p = await lookupPartnerCode(input.code);
  if (!p) throw new PartnerError("NOT_FOUND", "No partner with that code. Check it with your agency.");
  if (p.status !== "active") throw new PartnerError("INACTIVE", "That partner isn't approved by Guma Kart yet.");
  const db = getDb();
  return db.transaction(async (tx) => {
    // Serialise grants per shop so the "one partner at a time" rule gives a clear message.
    await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, input.tenantId)).for("update");
    const [other] = await tx
      .select({ partnerId: partnerShops.partnerId, name: partners.name })
      .from(partnerShops)
      .innerJoin(partners, eq(partners.id, partnerShops.partnerId))
      .where(and(eq(partnerShops.tenantId, input.tenantId), isNotNull(partnerShops.accessRole), isNull(partnerShops.revokedAt)))
      .limit(1);
    if (other && other.partnerId !== p.id) throw new PartnerError("TAKEN", `${other.name} already has access. Remove them first.`);
    const now = new Date();
    const [existing] = await tx
      .select()
      .from(partnerShops)
      .where(and(eq(partnerShops.partnerId, p.id), eq(partnerShops.tenantId, input.tenantId)))
      .limit(1);
    const [{ contactEmail } = { contactEmail: "" }] = await tx.select({ contactEmail: partners.contactEmail }).from(partners).where(eq(partners.id, p.id));
    if (existing) {
      const changed = existing.accessRole !== input.role || existing.revokedAt != null;
      await tx
        .update(partnerShops)
        .set({
          accessRole: input.role,
          revokedAt: null,
          grantedBy: input.ownerUserId,
          grantedAt: existing.accessRole && !existing.revokedAt ? existing.grantedAt : now,
          updatedAt: now,
        })
        .where(eq(partnerShops.id, existing.id));
      return { partnerId: p.id, name: p.name, contactEmail, changed };
    }
    await tx.insert(partnerShops).values({
      partnerId: p.id,
      tenantId: input.tenantId,
      source: "grant",
      accessRole: input.role,
      grantedBy: input.ownerUserId,
      grantedAt: now,
    });
    return { partnerId: p.id, name: p.name, contactEmail, changed: true };
  });
}

/** Owner removes the partner's access (referral record stays). */
export async function revokePartnerAccess(tenantId: string): Promise<{ partnerId: string; userId: string } | null> {
  const db = getDb();
  const [row] = await db
    .update(partnerShops)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(partnerShops.tenantId, tenantId), isNotNull(partnerShops.accessRole), isNull(partnerShops.revokedAt)))
    .returning({ partnerId: partnerShops.partnerId });
  if (!row) return null;
  const [p] = await db.select({ userId: partners.userId }).from(partners).where(eq(partners.id, row.partnerId));
  return { partnerId: row.partnerId, userId: p?.userId ?? "" };
}

export interface PartnerShopAccess {
  partnerId: string;
  partnerName: string;
  role: PartnerAccessRole;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantStatus: string;
}

/**
 * The security check behind every partner request: this user owns an ACTIVE partner that has an
 * unrevoked grant on this shop. Returns null otherwise (fail closed).
 */
export async function verifyPartnerAccess(userId: string, partnerId: string, tenantId: string): Promise<PartnerShopAccess | null> {
  const [row] = await getDb()
    .select({
      partnerId: partners.id,
      partnerName: partners.name,
      role: partnerShops.accessRole,
      tenantId: tenants.id,
      tenantSlug: tenants.slug,
      tenantName: tenants.name,
      tenantStatus: tenants.status,
    })
    .from(partnerShops)
    .innerJoin(partners, eq(partners.id, partnerShops.partnerId))
    .innerJoin(tenants, eq(tenants.id, partnerShops.tenantId))
    .innerJoin(users, eq(users.id, partners.userId))
    .where(
      and(
        eq(partners.id, partnerId),
        eq(partners.userId, userId),
        eq(partners.status, "active"),
        eq(users.role, "partner"),
        eq(users.status, "active"),
        eq(partnerShops.tenantId, tenantId),
        isNotNull(partnerShops.accessRole),
        isNull(partnerShops.revokedAt)
      )
    )
    .limit(1);
  if (!row || (row.role !== "manager" && row.role !== "staff")) return null;
  return { ...row, role: row.role, tenantStatus: String(row.tenantStatus) };
}

export async function touchPartnerOpen(partnerId: string, tenantId: string): Promise<void> {
  await getDb()
    .update(partnerShops)
    .set({ lastOpenedAt: new Date() })
    .where(and(eq(partnerShops.partnerId, partnerId), eq(partnerShops.tenantId, tenantId)));
}

export interface PartnerShopRow {
  tenantId: string;
  name: string;
  slug: string;
  source: "referral" | "grant";
  /** null = referral only, no access. */
  role: PartnerAccessRole | null;
  linkedAt: Date;
  lastOpenedAt: Date | null;
  /** Only for shops with access. */
  stats: { orders30d: number; sales30d: number; plan: string; status: string } | null;
}

/** The partner's dashboard list. */
export async function listPartnerShops(partnerId: string, now = new Date()): Promise<PartnerShopRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      tenantId: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      plan: tenants.subscriptionPlan,
      status: tenants.status,
      source: partnerShops.source,
      role: partnerShops.accessRole,
      revokedAt: partnerShops.revokedAt,
      createdAt: partnerShops.createdAt,
      grantedAt: partnerShops.grantedAt,
      lastOpenedAt: partnerShops.lastOpenedAt,
    })
    .from(partnerShops)
    .innerJoin(tenants, eq(tenants.id, partnerShops.tenantId))
    .where(eq(partnerShops.partnerId, partnerId))
    .orderBy(desc(partnerShops.updatedAt))
    .limit(500);
  const withAccess = rows.filter((r) => r.role && !r.revokedAt).map((r) => r.tenantId);
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const stats = withAccess.length
    ? await db
        .select({
          tenantId: orders.tenantId,
          n: sql<number>`count(*)::int`,
          sales: sql<string>`coalesce(sum(${orders.total} - coalesce(${orders.refundedAmount}, 0)), 0)`,
        })
        .from(orders)
        .where(
          and(
            inArray(orders.tenantId, withAccess),
            gte(orders.createdAt, since),
            sql`coalesce(${orders.orderState}::text, 'open') <> 'cancelled'`,
            isNull(orders.voidedAt)
          )
        )
        .groupBy(orders.tenantId)
    : [];
  const byTenant = new Map(stats.map((s) => [s.tenantId, s]));
  return rows.map((r) => {
    const active = Boolean(r.role && !r.revokedAt);
    const s = byTenant.get(r.tenantId);
    return {
      tenantId: r.tenantId,
      name: r.name,
      slug: r.slug,
      source: r.source,
      role: active ? (r.role as PartnerAccessRole) : null,
      linkedAt: r.grantedAt && active ? r.grantedAt : r.createdAt,
      lastOpenedAt: active ? r.lastOpenedAt : null,
      stats: active ? { orders30d: s?.n ?? 0, sales30d: Math.round(Number(s?.sales ?? 0) * 100) / 100, plan: String(r.plan ?? "free"), status: String(r.status) } : null,
    };
  });
}

// ─── Ops console ────────────────────────────────────────────────────────────

export interface OpsPartnerRow extends PartnerRow {
  email: string;
  referredShops: number;
  /** Referred shops on a paid plan — the base for a future commission decision. */
  referredPaid: number;
  shopsWithAccess: number;
}

export async function listPartnersForOps(filter: { status?: PartnerStatus | null; q?: string | null } = {}): Promise<OpsPartnerRow[]> {
  const db = getDb();
  const conds = [];
  if (filter.status) conds.push(eq(partners.status, filter.status));
  if (filter.q?.trim()) {
    const q = `%${filter.q.trim().toLowerCase()}%`;
    conds.push(sql`(lower(${partners.name}) like ${q} or lower(${partners.code}) like ${q} or lower(${partners.contactEmail}) like ${q})`);
  }
  const rows = await db
    .select({ p: partners, email: users.email })
    .from(partners)
    .innerJoin(users, eq(users.id, partners.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(partners.createdAt))
    .limit(300);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.p.id);
  const refs = await db
    .select({
      partnerId: tenants.referredByPartnerId,
      n: sql<number>`count(*)::int`,
      paid: sql<number>`count(*) filter (where ${tenants.subscriptionPlan} <> 'free')::int`,
    })
    .from(tenants)
    .where(inArray(tenants.referredByPartnerId, ids))
    .groupBy(tenants.referredByPartnerId);
  const access = await db
    .select({ partnerId: partnerShops.partnerId, n: sql<number>`count(*)::int` })
    .from(partnerShops)
    .where(and(inArray(partnerShops.partnerId, ids), isNotNull(partnerShops.accessRole), isNull(partnerShops.revokedAt)))
    .groupBy(partnerShops.partnerId);
  const refBy = new Map(refs.map((r) => [r.partnerId, r]));
  const accBy = new Map(access.map((a) => [a.partnerId, a.n]));
  return rows.map((r) => ({
    ...toRow(r.p),
    email: r.email ?? "",
    referredShops: refBy.get(r.p.id)?.n ?? 0,
    referredPaid: refBy.get(r.p.id)?.paid ?? 0,
    shopsWithAccess: accBy.get(r.p.id) ?? 0,
  }));
}

/** Ops: approve / suspend. Suspending blocks shop access at once (verifyPartnerAccess needs active). */
export async function setPartnerStatus(partnerId: string, status: PartnerStatus, note: string | null, actorUserId: string): Promise<PartnerRow> {
  if (!["pending", "active", "suspended"].includes(status)) throw new PartnerError("INVALID", "Unknown status.");
  const now = new Date();
  const [p] = await getDb()
    .update(partners)
    .set({
      status,
      statusNote: clean(note, 300),
      updatedAt: now,
      ...(status === "active" ? { approvedAt: now, approvedBy: actorUserId } : {}),
    })
    .where(eq(partners.id, partnerId))
    .returning();
  if (!p) throw new PartnerError("NOT_FOUND", "Partner not found.");
  return toRow(p);
}
