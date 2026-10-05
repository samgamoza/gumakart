import { and, asc, desc, eq, ilike, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  customers,
  orderItems,
  orderStatusHistory,
  orders,
  paymentTransactions,
  posStaff,
  productImages,
  productVariants,
  products,
  registerSessions,
  registers,
  tenants,
} from "../schema/index";
import { getDefaultLocationId } from "./locations";
import { insertOutboxEvent } from "./outbox";
import { describeStates, legacyStatusOf } from "./order-state";
import { OrderError } from "./order-status";
import { recordStockMovement } from "./stock-ledger";
import {
  checkTenders,
  computeSaleTotals,
  discountRateFor,
  vatConfigFromSettings,
  type PosDiscountType,
  type PosTender,
  type PosTenderMethod,
  type SaleTotals,
} from "../types/pos-tax";

/**
 * POS Lite (plan §12). A POS sale is an ordinary order — source_channel = 'pos',
 * paid and picked up in one transaction — so online and in-store sales share the
 * same stock (atomic decrement, never below zero), customers and reports.
 *
 * One register per location (V1); one open shift per register (unique index).
 */

export class PosError extends Error {
  constructor(
    message: string,
    public code:
      | "NO_SHIFT"
      | "SHIFT_CLOSED"
      | "SHIFT_OPEN"
      | "BAD_TENDER"
      | "EMPTY"
      | "STAFF_NAME_TAKEN"
      | "NOT_FOUND"
  ) {
    super(message);
    this.name = "PosError";
  }
}

const toCentavos = (value: string | number) => Math.round(Number(value) * 100);
const fromCentavos = (centavos: number) => (centavos / 100).toFixed(2);
const orderNumberPrefix = (slug: string) => slug.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "ORD";

// ─── Staff ───────────────────────────────────────────────────────────────────

export interface PosStaffRow {
  id: string;
  name: string;
  role: "cashier" | "manager";
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export async function listPosStaff(tenantId: string, options: { activeOnly?: boolean } = {}): Promise<PosStaffRow[]> {
  const db = getDb();
  return db
    .select({
      id: posStaff.id,
      name: posStaff.name,
      role: posStaff.role,
      active: posStaff.active,
      lastLoginAt: posStaff.lastLoginAt,
      createdAt: posStaff.createdAt,
    })
    .from(posStaff)
    .where(and(eq(posStaff.tenantId, tenantId), options.activeOnly ? eq(posStaff.active, true) : undefined))
    .orderBy(asc(posStaff.name));
}

/** `pinHash` is made by the caller (bcrypt in @gumakart/auth) — this package never sees a PIN. */
export async function createPosStaff(input: {
  tenantId: string;
  name: string;
  role: "cashier" | "manager";
  pinHash: string;
}): Promise<PosStaffRow> {
  const db = getDb();
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) throw new PosError("Enter a name.", "EMPTY");
  const [dupe] = await db
    .select({ id: posStaff.id })
    .from(posStaff)
    .where(and(eq(posStaff.tenantId, input.tenantId), sql`lower(${posStaff.name}) = lower(${name})`))
    .limit(1);
  if (dupe) throw new PosError("Someone on your team already has that name.", "STAFF_NAME_TAKEN");
  const [row] = await db
    .insert(posStaff)
    .values({ tenantId: input.tenantId, name, role: input.role, pinHash: input.pinHash })
    .returning();
  return { id: row!.id, name: row!.name, role: row!.role, active: row!.active, lastLoginAt: null, createdAt: row!.createdAt };
}

export async function updatePosStaff(
  tenantId: string,
  staffId: string,
  patch: { role?: "cashier" | "manager"; active?: boolean; pinHash?: string }
): Promise<boolean> {
  const db = getDb();
  const set: Partial<typeof posStaff.$inferInsert> & { pinVersion?: ReturnType<typeof sql> } = {};
  if (patch.role) set.role = patch.role;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.pinHash) {
    set.pinHash = patch.pinHash;
    set.failedAttempts = 0;
    set.lockedUntil = null;
  }
  // A new PIN, a role change or deactivation ends that person's open POS sessions.
  const bump = patch.pinHash !== undefined || patch.active === false || patch.role !== undefined;
  const updated = await db
    .update(posStaff)
    .set({ ...set, ...(bump ? { pinVersion: sql`${posStaff.pinVersion} + 1` } : {}) })
    .where(and(eq(posStaff.id, staffId), eq(posStaff.tenantId, tenantId)))
    .returning({ id: posStaff.id });
  return updated.length > 0;
}

export interface PosStaffAuthRow {
  id: string;
  tenantId: string;
  name: string;
  role: "cashier" | "manager";
  pinHash: string;
  pinVersion: number;
  active: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
}

export async function getPosStaffForAuth(tenantId: string, staffId: string): Promise<PosStaffAuthRow | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: posStaff.id,
      tenantId: posStaff.tenantId,
      name: posStaff.name,
      role: posStaff.role,
      pinHash: posStaff.pinHash,
      pinVersion: posStaff.pinVersion,
      active: posStaff.active,
      failedAttempts: posStaff.failedAttempts,
      lockedUntil: posStaff.lockedUntil,
    })
    .from(posStaff)
    .where(and(eq(posStaff.id, staffId), eq(posStaff.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;

/** Wrong PIN: count it; the 5th in a row locks the person out for 15 minutes. */
export async function recordPinFailure(staffId: string, now = new Date()): Promise<{ locked: boolean }> {
  const db = getDb();
  const [row] = await db
    .update(posStaff)
    .set({
      failedAttempts: sql`${posStaff.failedAttempts} + 1`,
      lockedUntil: sql`case when ${posStaff.failedAttempts} + 1 >= ${PIN_MAX_ATTEMPTS}
        then ${new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000).toISOString()}::timestamptz
        else ${posStaff.lockedUntil} end`,
    })
    .where(eq(posStaff.id, staffId))
    .returning({ failedAttempts: posStaff.failedAttempts });
  const locked = (row?.failedAttempts ?? 0) >= PIN_MAX_ATTEMPTS;
  if (locked) {
    // Start counting again after the lock ends.
    await db.update(posStaff).set({ failedAttempts: 0 }).where(eq(posStaff.id, staffId));
  }
  return { locked };
}

export async function recordPinSuccess(staffId: string): Promise<void> {
  const db = getDb();
  await db
    .update(posStaff)
    .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(posStaff.id, staffId));
}

// ─── Register & shifts ───────────────────────────────────────────────────────

export interface PosRegister {
  id: string;
  name: string;
  locationId: string;
}

/** The shop's register at its default location (created on first use). */
export async function ensureRegister(tenantId: string): Promise<PosRegister> {
  const db = getDb();
  const locationId = await getDefaultLocationId(db, tenantId);
  await db.insert(registers).values({ tenantId, locationId }).onConflictDoNothing();
  const [row] = await db
    .select({ id: registers.id, name: registers.name, locationId: registers.locationId })
    .from(registers)
    .where(and(eq(registers.tenantId, tenantId), eq(registers.locationId, locationId)))
    .limit(1);
  if (!row) throw new Error("Could not create the register.");
  return row;
}

export type TenderTotals = Record<PosTenderMethod, number>;
const ZERO_TENDERS: TenderTotals = { cash: 0, gcash: 0, maya: 0, card: 0 };

export interface PosShift {
  id: string;
  registerId: string;
  status: "open" | "closed";
  openingCash: number;
  openedAt: Date;
  openedBy: string | null;
  closedAt: Date | null;
  closedBy: string | null;
  expected: TenderTotals | null;
  counted: TenderTotals | null;
  variance: TenderTotals | null;
  closeNote: string | null;
}

function shiftFromRow(row: typeof registerSessions.$inferSelect, openedBy: string | null, closedBy: string | null): PosShift {
  return {
    id: row.id,
    registerId: row.registerId,
    status: row.status,
    openingCash: Number(row.openingCash),
    openedAt: row.openedAt,
    openedBy,
    closedAt: row.closedAt,
    closedBy,
    expected: (row.expectedJson as TenderTotals | null) ?? null,
    counted: (row.countedJson as TenderTotals | null) ?? null,
    variance: (row.varianceJson as TenderTotals | null) ?? null,
    closeNote: row.closeNote,
  };
}

async function staffName(staffId: string | null): Promise<string | null> {
  if (!staffId) return null;
  const db = getDb();
  const [row] = await db.select({ name: posStaff.name }).from(posStaff).where(eq(posStaff.id, staffId)).limit(1);
  return row?.name ?? null;
}

export async function getOpenShift(tenantId: string, registerId: string): Promise<PosShift | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(registerSessions)
    .where(
      and(
        eq(registerSessions.tenantId, tenantId),
        eq(registerSessions.registerId, registerId),
        eq(registerSessions.status, "open")
      )
    )
    .limit(1);
  if (!row) return null;
  return shiftFromRow(row, (await staffName(row.openedByStaffId)) ?? (row.openedByUserId ? "Owner" : null), null);
}

export async function openShift(input: {
  tenantId: string;
  registerId: string;
  openingCash: number;
  staffId?: string | null;
  userId?: string | null;
}): Promise<PosShift> {
  const db = getDb();
  if (!(input.openingCash >= 0) || input.openingCash > 1_000_000) {
    throw new PosError("Enter the cash in the drawer (₱0 or more).", "BAD_TENDER");
  }
  const inserted = await db
    .insert(registerSessions)
    .values({
      tenantId: input.tenantId,
      registerId: input.registerId,
      openingCash: fromCentavos(toCentavos(input.openingCash)),
      openedByStaffId: input.staffId ?? null,
      openedByUserId: input.userId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: registerSessions.id });
  const shift = await getOpenShift(input.tenantId, input.registerId);
  if (!shift) throw new Error("Could not open the shift.");
  if (inserted.length === 0) throw new PosError("A shift is already open on this register.", "SHIFT_OPEN");
  return shift;
}

export interface ShiftSummary {
  sales: number;
  salesTotal: number;
  discounts: number;
  seniorPwdSales: number;
  vat: number;
  /** Money received per method (cash already net of change). */
  byMethod: TenderTotals;
  /** Opening cash + cash kept from sales; e-wallet/card = what was recorded. */
  expected: TenderTotals;
}

export async function getShiftSummary(tenantId: string, shiftId: string): Promise<ShiftSummary | null> {
  const db = getDb();
  const [shift] = await db
    .select({ openingCash: registerSessions.openingCash })
    .from(registerSessions)
    .where(and(eq(registerSessions.id, shiftId), eq(registerSessions.tenantId, tenantId)))
    .limit(1);
  if (!shift) return null;
  const rows = await db
    .select({ total: orders.total, discount: orders.discount, tax: orders.tax, meta: orders.posMetaJson })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.registerSessionId, shiftId),
        sql`coalesce(${orders.orderState}::text, 'open') <> 'cancelled'`
      )
    );
  const byMethod: TenderTotals = { ...ZERO_TENDERS };
  let salesTotal = 0;
  let discounts = 0;
  let vat = 0;
  let seniorPwdSales = 0;
  for (const row of rows) {
    const meta = (row.meta ?? {}) as { paidByMethod?: Partial<TenderTotals>; discountType?: string };
    for (const m of Object.keys(byMethod) as PosTenderMethod[]) {
      byMethod[m] = toCentavos(byMethod[m]) / 100 + Number(meta.paidByMethod?.[m] ?? 0);
    }
    salesTotal += Number(row.total);
    discounts += Number(row.discount ?? 0);
    vat += Number(row.tax ?? 0);
    if (meta.discountType === "senior" || meta.discountType === "pwd") seniorPwdSales += 1;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  for (const m of Object.keys(byMethod) as PosTenderMethod[]) byMethod[m] = round(byMethod[m]);
  return {
    sales: rows.length,
    salesTotal: round(salesTotal),
    discounts: round(discounts),
    seniorPwdSales,
    vat: round(vat),
    byMethod,
    expected: { ...byMethod, cash: round(Number(shift.openingCash) + byMethod.cash) },
  };
}

export async function closeShift(input: {
  tenantId: string;
  shiftId: string;
  counted: TenderTotals;
  note?: string | null;
  staffId?: string | null;
  userId?: string | null;
}): Promise<PosShift> {
  const db = getDb();
  const summary = await getShiftSummary(input.tenantId, input.shiftId);
  if (!summary) throw new PosError("Shift not found.", "NOT_FOUND");
  const counted: TenderTotals = { ...ZERO_TENDERS };
  const variance: TenderTotals = { ...ZERO_TENDERS };
  for (const m of Object.keys(ZERO_TENDERS) as PosTenderMethod[]) {
    const value = Number(input.counted[m] ?? 0);
    if (!Number.isFinite(value) || value < 0) throw new PosError("Counted amounts must be ₱0 or more.", "BAD_TENDER");
    counted[m] = toCentavos(value) / 100;
    variance[m] = (toCentavos(counted[m]) - toCentavos(summary.expected[m])) / 100;
  }
  const [row] = await db
    .update(registerSessions)
    .set({
      status: "closed",
      closedAt: new Date(),
      closedByStaffId: input.staffId ?? null,
      closedByUserId: input.userId ?? null,
      expectedJson: summary.expected,
      countedJson: counted,
      varianceJson: variance,
      closeNote: input.note?.trim().slice(0, 500) || null,
    })
    .where(
      and(
        eq(registerSessions.id, input.shiftId),
        eq(registerSessions.tenantId, input.tenantId),
        eq(registerSessions.status, "open")
      )
    )
    .returning();
  if (!row) throw new PosError("This shift is already closed.", "SHIFT_CLOSED");
  return shiftFromRow(row, null, (await staffName(row.closedByStaffId)) ?? (row.closedByUserId ? "Owner" : null));
}

export async function listRecentShifts(tenantId: string, limit = 10): Promise<PosShift[]> {
  const db = getDb();
  const rows = await db
    .select({ s: registerSessions, opened: sql<string | null>`(select name from pos_staff where id = ${registerSessions.openedByStaffId})`, closed: sql<string | null>`(select name from pos_staff where id = ${registerSessions.closedByStaffId})` })
    .from(registerSessions)
    .where(eq(registerSessions.tenantId, tenantId))
    .orderBy(desc(registerSessions.openedAt))
    .limit(limit);
  return rows.map((r) =>
    shiftFromRow(r.s, r.opened ?? (r.s.openedByUserId ? "Owner" : null), r.closed ?? (r.s.closedByUserId ? "Owner" : null))
  );
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

export interface PosVariant {
  id: string;
  title: string;
  price: number;
  sku: string | null;
  barcode: string | null;
  stockQty: number;
  imageUrl: string | null;
}

export interface PosProduct {
  id: string;
  title: string;
  /** Default (first active) variant's values — the tile shows these. */
  price: number;
  sku: string | null;
  stockQty: number | null;
  trackInventory: boolean;
  imageUrl: string | null;
  /** Phase 9: more than one entry = the cashier picks a size/option. */
  variants: PosVariant[];
  hasOptions: boolean;
}

export async function listPosProducts(tenantId: string, query?: string): Promise<PosProduct[]> {
  const db = getDb();
  const q = query?.trim();
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      basePrice: products.basePrice,
      trackInventory: products.trackInventory,
      hasOptions: sql<boolean>`${products.optionsJson} is not null and jsonb_array_length(${products.optionsJson}) > 0`,
      firstImage: sql<string | null>`(select ${productImages.url} from ${productImages} where ${productImages.productId} = ${products.id} order by ${productImages.sortOrder} asc nulls last limit 1)`,
    })
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.status, "active"),
        q
          ? or(
              ilike(products.title, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
              sql`exists (select 1 from ${productVariants} v where v.product_id = ${products.id} and v.active and (lower(v.sku) = lower(${q}) or v.barcode = ${q}))`
            )
          : undefined
      )
    )
    .orderBy(asc(products.title))
    .limit(200);
  const ids = rows.map((r) => r.id);
  const variantRows = ids.length
    ? await db
        .select()
        .from(productVariants)
        .where(and(inArray(productVariants.productId, ids), eq(productVariants.active, true)))
        .orderBy(asc(productVariants.position), asc(productVariants.id))
    : [];
  const byProduct = new Map<string, PosVariant[]>();
  for (const v of variantRows) {
    byProduct.set(v.productId, [
      ...(byProduct.get(v.productId) ?? []),
      {
        id: v.id,
        title: v.title,
        price: Number(v.price),
        sku: v.sku,
        barcode: v.barcode,
        stockQty: v.stockQty ?? 0,
        imageUrl: v.imageUrl,
      },
    ]);
  }
  return rows
    .map((r) => {
      const variants = byProduct.get(r.id) ?? [];
      const first = variants[0];
      return {
        id: r.id,
        title: r.title,
        // Single-variant products charge the product price (see createPosSale).
        price: r.hasOptions && first ? first.price : Number(r.basePrice),
        sku: first?.sku ?? null,
        stockQty: first ? (r.hasOptions ? variants.reduce((n, v) => n + v.stockQty, 0) : first.stockQty) : null,
        trackInventory: Boolean(r.trackInventory),
        imageUrl: first?.imageUrl ?? r.firstImage,
        hasOptions: Boolean(r.hasOptions) && variants.length > 1,
        variants: r.hasOptions ? variants : variants.slice(0, 1).map((v) => ({ ...v, price: Number(r.basePrice) })),
      };
    })
    .filter((p) => p.variants.length > 0);
}

// ─── Sale ────────────────────────────────────────────────────────────────────

export interface PosSaleInput {
  tenantId: string;
  shiftId: string;
  staffId: string | null;
  userId: string | null;
  cashierName: string;
  idempotencyKey: string;
  items: Array<{ productId: string; quantity: number; variantId?: string | null }>;
  discountType: PosDiscountType;
  /** Senior/PWD: name and ID number on the card (kept for the seller's records). */
  discountHolder?: { name?: string | null; idNumber?: string | null } | null;
  tenders: PosTender[];
  customer?: { name?: string | null; phone?: string | null } | null;
}

export interface PosReceipt {
  orderId: string;
  orderNumber: string;
  createdAt: Date;
  shopName: string;
  cashierName: string;
  items: Array<{ title: string; quantity: number; unitPrice: number; lineTotal: number }>;
  totals: SaleTotals;
  discountType: PosDiscountType;
  discountHolder: { name: string | null; idNumberLast4: string | null } | null;
  tenders: Array<{ method: PosTenderMethod; amount: number; reference: string | null }>;
  change: number;
  customer: { name: string | null; phone: string | null };
  duplicate?: boolean;
}

export interface PosMeta {
  cashierName: string;
  discountType: PosDiscountType;
  discountHolder: { name: string | null; idNumberLast4: string | null } | null;
  totals: SaleTotals;
  tenders: Array<{ method: PosTenderMethod; amount: number; reference: string | null }>;
  change: number;
  paidByMethod: TenderTotals;
}

export async function getPosReceipt(tenantId: string, orderId: string): Promise<PosReceipt | null> {
  const db = getDb();
  const [row] = await db
    .select({ order: orders, shopName: tenants.name })
    .from(orders)
    .innerJoin(tenants, eq(orders.tenantId, tenants.id))
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), eq(orders.sourceChannel, "pos")))
    .limit(1);
  if (!row) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.id));
  const meta = (row.order.posMetaJson ?? {}) as PosMeta;
  return {
    orderId: row.order.id,
    orderNumber: row.order.orderNumber,
    createdAt: row.order.createdAt,
    shopName: row.shopName,
    cashierName: meta.cashierName ?? "",
    items: items.map((i) => ({
      title: i.titleSnapshot,
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice),
      lineTotal: Number(i.lineTotal),
    })),
    totals: meta.totals,
    discountType: meta.discountType ?? "none",
    discountHolder: meta.discountHolder ?? null,
    tenders: meta.tenders ?? [],
    change: meta.change ?? 0,
    customer: {
      name: row.order.guestName && row.order.guestName !== "Walk-in" ? row.order.guestName : null,
      phone: row.order.guestPhone,
    },
  };
}

async function findSaleByKey(tenantId: string, key: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.posIdempotencyKey, key)))
    .limit(1);
  return row?.id ?? null;
}

function normalizePhPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return digits;
  if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  return null;
}

/**
 * Rings up a sale. Idempotent per `idempotencyKey`: a retried Charge returns the
 * first sale's receipt (`duplicate: true`) instead of selling twice.
 */
export async function createPosSale(input: PosSaleInput): Promise<PosReceipt> {
  const db = getDb();
  const key = input.idempotencyKey.trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw new PosError("Missing sale key.", "EMPTY");

  const existing = await findSaleByKey(input.tenantId, key);
  if (existing) {
    const receipt = await getPosReceipt(input.tenantId, existing);
    if (receipt) return { ...receipt, duplicate: true };
  }

  const quantities = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) {
      throw new OrderError("Invalid item quantity.", "PRODUCT_UNAVAILABLE");
    }
    const key = `${item.productId}:${item.variantId ?? ""}`;
    const prev = quantities.get(key);
    quantities.set(key, { productId: item.productId, variantId: item.variantId ?? null, quantity: (prev?.quantity ?? 0) + item.quantity });
  }
  if (quantities.size === 0) throw new PosError("Add an item first.", "EMPTY");
  if (quantities.size > 100) throw new PosError("Too many different items in one sale.", "EMPTY");

  const phone = normalizePhPhone(input.customer?.phone);
  const customerName = input.customer?.name?.trim().slice(0, 120) || null;

  let saleId: string;
  try {
    saleId = await db.transaction(async (tx) => {
      // Lock the shift: a sale can't land on a shift that's closing.
      const [shift] = await tx
        .select({ id: registerSessions.id, status: registerSessions.status, registerId: registerSessions.registerId })
        .from(registerSessions)
        .where(and(eq(registerSessions.id, input.shiftId), eq(registerSessions.tenantId, input.tenantId)))
        .for("update");
      if (!shift) throw new PosError("Open a shift first.", "NO_SHIFT");
      if (shift.status !== "open") throw new PosError("This shift is closed. Open a new one.", "SHIFT_CLOSED");

      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (!tenant) throw new PosError("Shop not found.", "NOT_FOUND");

      const catalog = await tx
        .select({
          id: products.id,
          title: products.title,
          status: products.status,
          basePrice: products.basePrice,
          trackInventory: products.trackInventory,
          variantId: productVariants.id,
          variantTitle: productVariants.title,
          variantPrice: productVariants.price,
          stockQty: productVariants.stockQty,
          hasOptions: sql<boolean>`${products.optionsJson} is not null and jsonb_array_length(${products.optionsJson}) > 0`,
        })
        .from(products)
        .leftJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.active, true)))
        .where(
          and(
            eq(products.tenantId, input.tenantId),
            inArray(products.id, [...new Set([...quantities.values()].map((q) => q.productId))])
          )
        )
        .orderBy(asc(products.id), asc(productVariants.position), asc(productVariants.id));
      const variantsByProduct = new Map<string, (typeof catalog)[number][]>();
      for (const row of catalog) variantsByProduct.set(row.id, [...(variantsByProduct.get(row.id) ?? []), row]);

      let subtotalCentavos = 0;
      const lines: Array<{ productId: string; variantId: string | null; title: string; variantTitle: string | null; quantity: number; unit: number; track: boolean }> = [];
      for (const { productId, variantId, quantity } of quantities.values()) {
        const rows = variantsByProduct.get(productId) ?? [];
        let row = rows[0];
        if (!row || row.status !== "active") throw new OrderError("An item in this sale is no longer for sale.", "PRODUCT_UNAVAILABLE");
        if (variantId) {
          const match = rows.find((r) => r.variantId === variantId);
          if (!match) throw new OrderError(`That option of "${row.title}" is no longer for sale.`, "PRODUCT_UNAVAILABLE");
          row = match;
        } else if (row.hasOptions && rows.length > 1) {
          throw new PosError(`Pick a size or option for "${row.title}".`, "EMPTY");
        }
        const unit = toCentavos(row.hasOptions && row.variantPrice != null ? row.variantPrice : row.basePrice);
        subtotalCentavos += unit * quantity;
        lines.push({
          productId,
          variantId: row.variantId,
          title: row.hasOptions ? `${row.title} (${row.variantTitle})` : row.title,
          variantTitle: row.hasOptions ? row.variantTitle : null,
          quantity,
          unit,
          track: Boolean(row.trackInventory),
        });
      }

      const settings = (tenant.settingsJson ?? {}) as { pos?: { vatRate?: unknown; vatInclusive?: unknown; vatRegistered?: unknown } };
      const totals = computeSaleTotals({
        subtotal: subtotalCentavos / 100,
        discountRate: discountRateFor(input.discountType),
        discountType: input.discountType,
        config: vatConfigFromSettings(settings.pos),
      });
      const tenderCheck = checkTenders(totals.total, input.tenders);
      if (!tenderCheck.ok) throw new PosError(tenderCheck.error, "BAD_TENDER");

      const now = new Date();
      const facts = { orderState: "completed" as const, paymentState: "paid" as const, fulfillmentState: "delivered" as const, accepted: true };
      const locationId = await getDefaultLocationId(tx, input.tenantId);
      const [seqRow] = await tx
        .update(tenants)
        .set({ nextOrderSeq: sql`${tenants.nextOrderSeq} + 1` })
        .where(eq(tenants.id, input.tenantId))
        .returning({ nextOrderSeq: tenants.nextOrderSeq });
      const orderNumber = `${orderNumberPrefix(tenant.slug)}-${String((seqRow?.nextOrderSeq ?? 2) - 1).padStart(4, "0")}`;

      let customerRecordId: string | null = null;
      if (phone) {
        const [cust] = await tx
          .insert(customers)
          .values({ tenantId: input.tenantId, phone, name: customerName, firstOrderAt: now, lastOrderAt: now })
          .onConflictDoUpdate({
            target: [customers.tenantId, customers.phone],
            set: { name: sql`coalesce(nullif(excluded.name, ''), ${customers.name})`, lastOrderAt: now, updatedAt: now },
          })
          .returning({ id: customers.id });
        customerRecordId = cust?.id ?? null;
      }

      const holder =
        input.discountType !== "none"
          ? {
              name: input.discountHolder?.name?.trim().slice(0, 120) || null,
              idNumberLast4: input.discountHolder?.idNumber?.replace(/\s/g, "").slice(-4) || null,
            }
          : null;
      const tenders = input.tenders.map((t) => ({
        method: t.method,
        amount: Math.round(Number(t.amount) * 100) / 100,
        reference: t.reference?.trim().slice(0, 60) || null,
      }));
      const meta: PosMeta = {
        cashierName: input.cashierName,
        discountType: input.discountType,
        discountHolder: holder,
        totals,
        tenders,
        change: tenderCheck.change,
        paidByMethod: tenderCheck.paidByMethod,
      };
      const primary = [...tenders].sort((a, b) => b.amount - a.amount)[0]!.method;

      const [order] = await tx
        .insert(orders)
        .values({
          tenantId: input.tenantId,
          orderNumber,
          customerRecordId,
          guestName: customerName ?? "Walk-in",
          guestPhone: phone,
          status: legacyStatusOf(facts),
          subtotal: fromCentavos(subtotalCentavos),
          discount: fromCentavos(toCentavos(totals.discountAmount)),
          // VAT-inclusive prices: the VAT inside the total (for the receipt / reports).
          tax: fromCentavos(toCentavos(totals.vatAmount)),
          deliveryFee: "0.00",
          total: fromCentavos(toCentavos(totals.total)),
          paymentStatus: "paid",
          paymentMethod: primary,
          deliveryType: "pickup",
          sourceChannel: "pos",
          orderState: facts.orderState,
          paymentState: facts.paymentState,
          fulfillmentState: facts.fulfillmentState,
          acceptedAt: now,
          paidAt: now,
          completedAt: now,
          locationId,
          registerSessionId: input.shiftId,
          posStaffId: input.staffId,
          posIdempotencyKey: key,
          posMetaJson: meta,
        })
        .returning({ id: orders.id });
      if (!order) throw new Error("Failed to save the sale.");

      await tx.insert(orderItems).values(
        lines.map((l) => ({
          orderId: order.id,
          productId: l.productId,
          variantId: l.variantId,
          titleSnapshot: l.title,
          variantSnapshot: l.variantTitle,
          quantity: l.quantity,
          unitPrice: fromCentavos(l.unit),
          lineTotal: fromCentavos(l.unit * l.quantity),
        }))
      );

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        status: legacyStatusOf(facts),
        event: "pos_sale",
        toState: describeStates(facts),
        note: `POS sale by ${input.cashierName}${input.discountType !== "none" ? ` · ${input.discountType === "pwd" ? "PWD" : "Senior"} discount` : ""}`,
        actorId: input.userId,
      });

      await tx.insert(paymentTransactions).values(
        tenders.map((t, i) => ({
          orderId: order.id,
          tenantId: input.tenantId,
          gateway: "manual" as const,
          gatewayIntentId: `pos_${order.id}_${i + 1}`,
          // Cash row records what the drawer kept (net of change).
          amount: fromCentavos(toCentavos(t.method === "cash" ? t.amount - tenderCheck.change : t.amount)),
          status: "paid" as const,
          methodType: t.method,
          reference: t.reference,
          paidAt: now,
        }))
      );

      // Same atomic, never-below-zero decrement as online checkout: online and
      // POS can't both sell the last unit.
      for (const l of lines) {
        if (!l.track || !l.variantId) continue;
        const decremented = await tx
          .update(productVariants)
          .set({ stockQty: sql`${productVariants.stockQty} - ${l.quantity}` })
          .where(and(eq(productVariants.id, l.variantId), sql`${productVariants.stockQty} >= ${l.quantity}`))
          .returning({ stockQty: productVariants.stockQty });
        if (decremented.length === 0) {
          throw new OrderError(`Not enough stock for "${l.title}". Update the stock in Products first.`, "OUT_OF_STOCK");
        }
        await recordStockMovement(tx, {
          tenantId: input.tenantId,
          variantId: l.variantId,
          orderId: order.id,
          reason: "sale",
          delta: -l.quantity,
          balanceAfter: decremented[0]!.stockQty,
          locationId,
        });
      }

      const eventData = {
        tenantId: input.tenantId,
        orderId: order.id,
        orderNumber,
        paymentMethod: primary,
        sourceChannel: "pos",
        total: fromCentavos(toCentavos(totals.total)),
        ...facts,
      };
      await insertOutboxEvent(tx, { name: "Order.Created.V2", tenantId: input.tenantId, idempotencyKey: `Order.Created.V2:${order.id}`, data: eventData });
      await insertOutboxEvent(tx, { name: "Order.Completed.V1", tenantId: input.tenantId, idempotencyKey: `Order.Completed.V1:${order.id}`, data: eventData });
      return order.id;
    });
  } catch (error) {
    // Two taps raced past the first lookup: the unique key stopped the second.
    if (error instanceof Error && /orders_pos_idempotency_idx/.test(`${error.message} ${(error as { constraint_name?: string }).constraint_name ?? ""}`)) {
      const id = await findSaleByKey(input.tenantId, key);
      const receipt = id ? await getPosReceipt(input.tenantId, id) : null;
      if (receipt) return { ...receipt, duplicate: true };
    }
    throw error;
  }

  const receipt = await getPosReceipt(input.tenantId, saleId);
  if (!receipt) throw new Error("Sale saved but the receipt could not be read.");
  return receipt;
}

export interface PosSaleListItem {
  orderId: string;
  orderNumber: string;
  total: number;
  createdAt: Date;
  cashierName: string | null;
  itemCount: number;
  method: string | null;
}

export async function listShiftSales(tenantId: string, shiftId: string, limit = 50): Promise<PosSaleListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      total: orders.total,
      createdAt: orders.createdAt,
      meta: orders.posMetaJson,
      method: orders.paymentMethod,
      itemCount: sql<number>`(select coalesce(sum(${orderItems.quantity}), 0)::int from ${orderItems} where ${orderItems.orderId} = ${orders.id})`,
    })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.registerSessionId, shiftId), isNotNull(orders.registerSessionId), ne(orders.sourceChannel, "storefront")))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    orderId: r.orderId,
    orderNumber: r.orderNumber,
    total: Number(r.total),
    createdAt: r.createdAt,
    cashierName: ((r.meta ?? {}) as { cashierName?: string }).cashierName ?? null,
    itemCount: Number(r.itemCount),
    method: r.method,
  }));
}
