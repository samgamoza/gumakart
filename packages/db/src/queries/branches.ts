import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../client";
import { locationStock, locations, productVariants, products, registers, tenants } from "../schema/index";
import { getDefaultLocationId } from "./locations";
import { recordStockMovement } from "./stock-ledger";

/**
 * Phase 17 — branches (multi-location stock).
 *
 * The variant's stock_qty stays the shop-wide total that every sale path already checks and
 * decrements. Once a shop has a second branch, `location_stock` holds the split, and a DB
 * trigger (migration 0035) keeps the branches adding up to the total: a sale or restock lands
 * on the POS's branch (set_config('guma.location_id')) or the default branch, and a decrease
 * that branch can't cover spills to the others. Branch counts and transfers write both sides
 * themselves with the trigger switched off for their transaction.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class BranchError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID" | "SHORT" | "HAS_STOCK",
    message: string
  ) {
    super(message);
  }
}

export const MAX_BRANCHES = 20;

export interface BranchRow {
  id: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  phone: string | null;
  isDefault: boolean;
  isActive: boolean;
  units: number;
}

export async function branchStockEnabled(tx: Tx | Db, tenantId: string): Promise<boolean> {
  const [t] = await tx.select({ on: tenants.branchStockEnabled }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return Boolean(t?.on);
}

export async function listBranches(tenantId: string): Promise<{ enabled: boolean; branches: BranchRow[] }> {
  const db = getDb();
  await getDefaultLocationId(db, tenantId);
  const enabled = await branchStockEnabled(db, tenantId);
  const rows = await db
    .select({
      l: locations,
      units: sql<number>`coalesce((select sum(ls.qty) from location_stock ls where ls.location_id = "locations"."id"), 0)::int`,
    })
    .from(locations)
    .where(eq(locations.tenantId, tenantId))
    .orderBy(sql`${locations.isDefault} desc`, asc(locations.createdAt));
  return {
    enabled,
    branches: rows.map((r) => ({
      id: r.l.id,
      name: r.l.name,
      addressLine: r.l.addressLine,
      city: r.l.city,
      phone: r.l.phone,
      isDefault: r.l.isDefault,
      isActive: r.l.isActive,
      units: r.units,
    })),
  };
}

/** Turns branch stock on: everything currently in stock is at the default branch. */
async function enableBranchStockInTx(tx: Tx, tenantId: string): Promise<void> {
  if (await branchStockEnabled(tx, tenantId)) return;
  const defaultId = await getDefaultLocationId(tx, tenantId);
  await tx.execute(sql`
    insert into location_stock (location_id, variant_id, tenant_id, qty)
    select ${defaultId}::uuid, v.id, ${tenantId}::uuid, greatest(coalesce(v.stock_qty, 0), 0)
    from product_variants v join products p on p.id = v.product_id
    where p.tenant_id = ${tenantId}::uuid
    on conflict (location_id, variant_id) do update set qty = excluded.qty, updated_at = now()`);
  await tx.update(tenants).set({ branchStockEnabled: true }).where(eq(tenants.id, tenantId));
}

export async function createBranch(
  tenantId: string,
  input: { name: string; addressLine?: string | null; city?: string | null; phone?: string | null }
): Promise<BranchRow> {
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new BranchError("INVALID", "Give the branch a name, like \"SM Lipa stall\".");
  return getDb().transaction(async (tx) => {
    await getDefaultLocationId(tx, tenantId);
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(locations).where(eq(locations.tenantId, tenantId));
    if (n >= MAX_BRANCHES) throw new BranchError("INVALID", `Up to ${MAX_BRANCHES} branches per shop.`);
    await enableBranchStockInTx(tx, tenantId);
    const [row] = await tx
      .insert(locations)
      .values({
        tenantId,
        name,
        addressLine: input.addressLine?.trim().slice(0, 300) || null,
        city: input.city?.trim().slice(0, 120) || null,
        phone: input.phone?.trim().slice(0, 20) || null,
        isDefault: false,
        isActive: true,
      })
      .returning();
    return { id: row!.id, name: row!.name, addressLine: row!.addressLine, city: row!.city, phone: row!.phone, isDefault: false, isActive: true, units: 0 };
  });
}

export async function updateBranch(
  tenantId: string,
  id: string,
  patch: { name?: string; addressLine?: string | null; city?: string | null; phone?: string | null; isActive?: boolean; makeDefault?: boolean }
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [loc] = await tx.select().from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, id))).for("update");
    if (!loc) throw new BranchError("NOT_FOUND", "That branch doesn't exist.");
    const set: Partial<typeof locations.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) {
      const name = patch.name.trim().slice(0, 120);
      if (name.length < 2) throw new BranchError("INVALID", "Give the branch a name.");
      set.name = name;
    }
    if (patch.addressLine !== undefined) set.addressLine = patch.addressLine?.trim().slice(0, 300) || null;
    if (patch.city !== undefined) set.city = patch.city?.trim().slice(0, 120) || null;
    if (patch.phone !== undefined) set.phone = patch.phone?.trim().slice(0, 20) || null;
    if (patch.isActive === false) {
      if (loc.isDefault) throw new BranchError("INVALID", "Make another branch the main one first.");
      const [{ units } = { units: 0 }] = await tx
        .select({ units: sql<number>`coalesce(sum(${locationStock.qty}), 0)::int` })
        .from(locationStock)
        .where(eq(locationStock.locationId, id));
      if (units > 0) throw new BranchError("HAS_STOCK", `This branch still has ${units} item(s). Transfer them to another branch first.`);
      set.isActive = false;
    } else if (patch.isActive === true) set.isActive = true;
    if (patch.makeDefault && !loc.isDefault) {
      if (!loc.isActive && patch.isActive !== true) throw new BranchError("INVALID", "Turn the branch on first.");
      // The partial unique index allows one default: clear the old one first.
      await tx.update(locations).set({ isDefault: false, updatedAt: new Date() }).where(and(eq(locations.tenantId, tenantId), eq(locations.isDefault, true)));
      set.isDefault = true;
    }
    await tx.update(locations).set(set).where(eq(locations.id, id));
  });
}

async function activeBranch(tx: Tx | Db, tenantId: string, id: string) {
  const [loc] = await tx
    .select({ id: locations.id, name: locations.name, isActive: locations.isActive })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, id)))
    .limit(1);
  if (!loc) throw new BranchError("NOT_FOUND", "That branch doesn't exist.");
  if (!loc.isActive) throw new BranchError("INVALID", `${loc.name} is turned off.`);
  return loc;
}

export interface BranchStockRow {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  total: number;
  byBranch: Record<string, number>;
}

/** Stock per variant per branch (tracked products only). */
export async function getBranchStock(tenantId: string, options: { q?: string | null; limit?: number } = {}): Promise<{ branches: BranchRow[]; rows: BranchStockRow[] }> {
  const db = getDb();
  const { branches } = await listBranches(tenantId);
  const q = options.q?.trim();
  const variants = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productTitle: products.title,
      variantTitle: productVariants.title,
      sku: productVariants.sku,
      total: productVariants.stockQty,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(productVariants.active, true),
        sql`coalesce(${products.trackInventory}, true)`,
        q ? sql`(${products.title} ilike ${`%${q.replace(/[%_\\]/g, "\\$&")}%`} or lower(${productVariants.sku}) = lower(${q}))` : undefined
      )
    )
    .orderBy(asc(products.title), asc(productVariants.position))
    .limit(Math.min(options.limit ?? 500, 2000));
  const split = variants.length
    ? await db.select().from(locationStock).where(and(eq(locationStock.tenantId, tenantId), inArray(locationStock.variantId, variants.map((v) => v.variantId))))
    : [];
  const by = new Map<string, Record<string, number>>();
  for (const s of split) by.set(s.variantId, { ...(by.get(s.variantId) ?? {}), [s.locationId]: s.qty });
  return {
    branches,
    rows: variants.map((v) => ({ ...v, total: v.total ?? 0, byBranch: by.get(v.variantId) ?? {} })),
  };
}

export interface BranchActor {
  userId: string | null;
  name: string;
}

/** Moves stock between branches. The shop-wide total doesn't change. All or nothing. */
export async function transferStock(
  tenantId: string,
  input: { fromId: string; toId: string; items: Array<{ variantId: string; qty: number }>; note?: string | null },
  actor: BranchActor
): Promise<{ moved: number }> {
  if (input.fromId === input.toId) throw new BranchError("INVALID", "Pick two different branches.");
  const items = input.items.filter((i) => Number.isInteger(i.qty) && i.qty > 0);
  if (items.length === 0) throw new BranchError("INVALID", "Enter how many to move.");
  if (items.length > 500) throw new BranchError("INVALID", "Up to 500 items per transfer.");
  return getDb().transaction(async (tx) => {
    if (!(await branchStockEnabled(tx, tenantId))) throw new BranchError("INVALID", "Add a second branch first.");
    const from = await activeBranch(tx, tenantId, input.fromId);
    const to = await activeBranch(tx, tenantId, input.toId);
    const ids = [...new Set(items.map((i) => i.variantId))];
    const owned = await tx
      .select({ id: productVariants.id, title: productVariants.title, productTitle: products.title, total: productVariants.stockQty })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(products.tenantId, tenantId), inArray(productVariants.id, ids)));
    const info = new Map(owned.map((o) => [o.id, o]));
    if (owned.length !== ids.length) throw new BranchError("NOT_FOUND", "Some items aren't in this shop.");
    let moved = 0;
    const note = `${from.name} → ${to.name}${input.note?.trim() ? ` · ${input.note.trim()}` : ""}`.slice(0, 200);
    for (const it of items) {
      const v = info.get(it.variantId)!;
      const [src] = await tx
        .select({ qty: locationStock.qty })
        .from(locationStock)
        .where(and(eq(locationStock.locationId, from.id), eq(locationStock.variantId, it.variantId)))
        .for("update");
      const have = src?.qty ?? 0;
      if (have < it.qty) throw new BranchError("SHORT", `${from.name} only has ${have} of "${v.productTitle}${v.title !== "Default" ? ` (${v.title})` : ""}".`);
      await tx
        .update(locationStock)
        .set({ qty: sql`${locationStock.qty} - ${it.qty}`, updatedAt: new Date() })
        .where(and(eq(locationStock.locationId, from.id), eq(locationStock.variantId, it.variantId)));
      await tx
        .insert(locationStock)
        .values({ locationId: to.id, variantId: it.variantId, tenantId, qty: it.qty })
        .onConflictDoUpdate({ target: [locationStock.locationId, locationStock.variantId], set: { qty: sql`${locationStock.qty} + ${it.qty}`, updatedAt: new Date() } });
      const total = v.total ?? 0;
      await recordStockMovement(tx, { tenantId, variantId: it.variantId, reason: "transfer_out", delta: -it.qty, balanceAfter: total, actorId: actor.userId, note, locationId: from.id });
      await recordStockMovement(tx, { tenantId, variantId: it.variantId, reason: "transfer_in", delta: it.qty, balanceAfter: total, actorId: actor.userId, note, locationId: to.id });
      moved += it.qty;
    }
    return { moved };
  });
}

/**
 * A stock count at one branch: sets that branch's numbers and moves the shop-wide total by
 * the same difference (the trigger is off for this transaction so it isn't applied twice).
 */
export async function setBranchCount(
  tenantId: string,
  locationId: string,
  items: Array<{ variantId: string; qty: number }>,
  actor: BranchActor
): Promise<{ changed: number }> {
  const clean = items.filter((i) => Number.isInteger(i.qty) && i.qty >= 0 && i.qty <= 1_000_000);
  if (clean.length !== items.length) throw new BranchError("INVALID", "Counts must be whole numbers, 0 or more.");
  if (clean.length === 0) return { changed: 0 };
  return getDb().transaction(async (tx) => {
    if (!(await branchStockEnabled(tx, tenantId))) throw new BranchError("INVALID", "Add a second branch first.");
    const loc = await activeBranch(tx, tenantId, locationId);
    await tx.execute(sql`select set_config('guma.branch_sync', 'off', true)`);
    const ids = [...new Set(clean.map((i) => i.variantId))];
    const owned = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(products.tenantId, tenantId), inArray(productVariants.id, ids)));
    if (owned.length !== ids.length) throw new BranchError("NOT_FOUND", "Some items aren't in this shop.");
    let changed = 0;
    for (const it of clean) {
      const [cur] = await tx
        .select({ qty: locationStock.qty })
        .from(locationStock)
        .where(and(eq(locationStock.locationId, loc.id), eq(locationStock.variantId, it.variantId)))
        .for("update");
      const delta = it.qty - (cur?.qty ?? 0);
      if (delta === 0) continue;
      await tx
        .insert(locationStock)
        .values({ locationId: loc.id, variantId: it.variantId, tenantId, qty: it.qty })
        .onConflictDoUpdate({ target: [locationStock.locationId, locationStock.variantId], set: { qty: it.qty, updatedAt: new Date() } });
      const [after] = await tx
        .update(productVariants)
        .set({ stockQty: sql`coalesce(${productVariants.stockQty}, 0) + ${delta}` })
        .where(eq(productVariants.id, it.variantId))
        .returning({ stockQty: productVariants.stockQty });
      await recordStockMovement(tx, { tenantId, variantId: it.variantId, reason: "branch_count", delta, balanceAfter: after?.stockQty ?? null, actorId: actor.userId, note: `Count at ${loc.name}`, locationId: loc.id });
      changed += 1;
    }
    await tx.execute(sql`select set_config('guma.branch_sync', '', true)`);
    return { changed };
  });
}

/** POS: the branch a register sells from (validated), else the shop's default. */
export async function resolvePosLocationId(tx: Tx | Db, tenantId: string, wanted: string | null | undefined): Promise<string> {
  if (wanted && /^[0-9a-f-]{36}$/i.test(wanted)) {
    const [loc] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.id, wanted), eq(locations.isActive, true)))
      .limit(1);
    if (loc) return loc.id;
  }
  return getDefaultLocationId(tx, tenantId);
}

/** The branch a register belongs to. */
export async function registerLocationId(tx: Tx | Db, registerId: string): Promise<string | null> {
  const [r] = await tx.select({ locationId: registers.locationId }).from(registers).where(eq(registers.id, registerId)).limit(1);
  return r?.locationId ?? null;
}
