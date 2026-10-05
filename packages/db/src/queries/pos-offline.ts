import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "../client";
import { orders, posInvoiceBlocks, posInvoiceCounters, posSyncIssues, registers, tenants, type PosSyncIssueKind } from "../schema/index";
import type { TenantSettingsJson } from "../types/tenant-settings";
import { birActive, formatInvoiceNumber } from "./bir";

/**
 * Phase 12b — POS offline mode (server side).
 *
 * The register keeps selling when the internet drops: each sale is saved on the device
 * with its idempotency key and synced later through the normal sale endpoint with an
 * `offline` block (see createPosSale). This module holds the pieces around that:
 *
 *  - BIR invoice blocks: with BIR numbering on, a device reserves a small block of
 *    numbers from its register's counter while online. Offline receipts use those, so the
 *    printed number is real and never reused. Online sales keep drawing from the counter
 *    (after the block), so numbers across devices aren't in time order — each block is.
 *  - Sync issues: what an offline sale needs the owner to check (stock ran short, a price
 *    changed, a number was reassigned, it landed on a closed shift or after a Z reading,
 *    or it couldn't be saved at all — then the full sale is kept here so nothing is lost).
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const OFFLINE_BLOCK_SIZE = 25;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,40}$/;

export class PosOfflineError extends Error {
  constructor(message: string, public code: "BIR_OFF" | "BAD_DEVICE" | "NOT_FOUND") {
    super(message);
    this.name = "PosOfflineError";
  }
}

export interface InvoiceBlock {
  id: string;
  registerId: string;
  deviceId: string;
  prefix: string;
  startNo: number;
  endNo: number;
  /** Formatted first/last numbers, for showing. */
  from: string;
  to: string;
  createdAt: Date;
  releasedAt: Date | null;
  /** Lowest number after the last one the server has seen used (for a device that lost its place). */
  nextFree?: number;
}

function toBlock(row: typeof posInvoiceBlocks.$inferSelect): InvoiceBlock {
  return {
    id: row.id,
    registerId: row.registerId,
    deviceId: row.deviceId,
    prefix: row.prefix,
    startNo: row.startNo,
    endNo: row.endNo,
    from: formatInvoiceNumber(row.prefix, row.startNo),
    to: formatInvoiceNumber(row.prefix, row.endNo),
    createdAt: row.createdAt,
    releasedAt: row.releasedAt,
  };
}

async function birFor(tenantId: string) {
  const [t] = await getDb().select({ settings: tenants.settingsJson }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return birActive((t?.settings ?? null) as TenantSettingsJson | null);
}

/**
 * The device's current block, or a new one when it has none (or says `replaceBlockId`
 * is used up). Numbers come off the register's counter in the same lock as online sales.
 */
export async function getOrReserveInvoiceBlock(input: {
  tenantId: string;
  registerId: string;
  deviceId: string;
  replaceBlockId?: string | null;
  size?: number;
}): Promise<InvoiceBlock> {
  if (!DEVICE_ID.test(input.deviceId)) throw new PosOfflineError("Unknown device.", "BAD_DEVICE");
  const bir = await birFor(input.tenantId);
  if (!bir) throw new PosOfflineError("BIR invoices are off for this shop.", "BIR_OFF");
  const size = Math.min(Math.max(Math.trunc(input.size ?? OFFLINE_BLOCK_SIZE), 5), 200);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [reg] = await tx
      .select({ id: registers.id })
      .from(registers)
      .where(and(eq(registers.id, input.registerId), eq(registers.tenantId, input.tenantId)))
      .limit(1);
    if (!reg) throw new PosOfflineError("Register not found.", "NOT_FOUND");
    await tx.insert(posInvoiceCounters).values({ registerId: reg.id, tenantId: input.tenantId, prefix: bir.invoicePrefix ?? "" }).onConflictDoNothing();
    // Same lock as nextInvoiceNumberInTx: blocks and online numbers never overlap.
    const [counter] = await tx.select().from(posInvoiceCounters).where(eq(posInvoiceCounters.registerId, reg.id)).for("update");
    const [current] = await tx
      .select()
      .from(posInvoiceBlocks)
      .where(
        and(
          eq(posInvoiceBlocks.tenantId, input.tenantId),
          eq(posInvoiceBlocks.registerId, reg.id),
          eq(posInvoiceBlocks.deviceId, input.deviceId),
          isNull(posInvoiceBlocks.releasedAt)
        )
      )
      .orderBy(desc(posInvoiceBlocks.createdAt))
      .limit(1);
    const prefix = (bir.invoicePrefix ?? "").trim().toUpperCase().slice(0, 12);
    if (current && current.id !== input.replaceBlockId && current.prefix === prefix) {
      const block = toBlock(current);
      const [used] = await tx
        .select({ last: sql<string | null>`max(${orders.invoiceNumber})` })
        .from(orders)
        .where(and(eq(orders.tenantId, input.tenantId), gte(orders.invoiceNumber, block.from), lte(orders.invoiceNumber, block.to)));
      const lastUsed = used?.last ? Number(used.last.slice(-10)) : null;
      return { ...block, nextFree: lastUsed !== null && Number.isFinite(lastUsed) ? lastUsed + 1 : block.startNo };
    }
    const start = counter!.nextInvoice;
    await tx.update(posInvoiceCounters).set({ nextInvoice: start + size }).where(eq(posInvoiceCounters.registerId, reg.id));
    const [row] = await tx
      .insert(posInvoiceBlocks)
      .values({ tenantId: input.tenantId, registerId: reg.id, deviceId: input.deviceId, prefix, startNo: start, endNo: start + size - 1 })
      .returning();
    return { ...toBlock(row!), nextFree: start };
  });
}

/**
 * Inside the sale transaction: accept the number printed offline when it's inside one of
 * this device's blocks for this register and not used yet. Returns null otherwise (the
 * caller assigns a fresh number and files an "invoice_reassigned" issue).
 */
export async function claimOfflineInvoiceInTx(
  tx: Tx,
  input: { tenantId: string; registerId: string; deviceId: string; invoiceNumber: string }
): Promise<string | null> {
  const printed = input.invoiceNumber.trim().toUpperCase();
  const m = /^([A-Z0-9-]{0,12}?)(\d{10})$/.exec(printed);
  if (!m) return null;
  const prefix = m[1] ?? "";
  const n = Number(m[2]);
  const [block] = await tx
    .select({ id: posInvoiceBlocks.id })
    .from(posInvoiceBlocks)
    .where(
      and(
        eq(posInvoiceBlocks.tenantId, input.tenantId),
        eq(posInvoiceBlocks.registerId, input.registerId),
        eq(posInvoiceBlocks.deviceId, input.deviceId),
        eq(posInvoiceBlocks.prefix, prefix),
        lte(posInvoiceBlocks.startNo, n),
        gte(posInvoiceBlocks.endNo, n)
      )
    )
    .limit(1);
  if (!block) return null;
  const [taken] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.tenantId, input.tenantId), eq(orders.invoiceNumber, printed)))
    .limit(1);
  return taken ? null : printed;
}

export interface InvoiceBlockRow extends InvoiceBlock {
  used: number;
  size: number;
}

/** Blocks for the BIR settings card: how many numbers each device has used. */
export async function listInvoiceBlocks(tenantId: string, limit = 30): Promise<InvoiceBlockRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(posInvoiceBlocks)
    .where(eq(posInvoiceBlocks.tenantId, tenantId))
    .orderBy(desc(posInvoiceBlocks.createdAt))
    .limit(limit);
  const out: InvoiceBlockRow[] = [];
  for (const row of rows) {
    const b = toBlock(row);
    const [c] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), gte(orders.invoiceNumber, b.from), lte(orders.invoiceNumber, b.to)));
    out.push({ ...b, used: Number(c?.n ?? 0), size: row.endNo - row.startNo + 1 });
  }
  return out;
}

/**
 * Owner: a device is lost or retired. Its unused numbers are listed as never issued
 * (for the accountant), and it gets a fresh block next time it's online.
 */
export async function releaseInvoiceBlock(tenantId: string, blockId: string, actorName: string): Promise<InvoiceBlock> {
  const [row] = await getDb()
    .update(posInvoiceBlocks)
    .set({ releasedAt: new Date(), releasedByName: actorName.slice(0, 80) })
    .where(and(eq(posInvoiceBlocks.id, blockId), eq(posInvoiceBlocks.tenantId, tenantId), isNull(posInvoiceBlocks.releasedAt)))
    .returning();
  if (!row) throw new PosOfflineError("Block not found or already released.", "NOT_FOUND");
  return toBlock(row);
}

// ─── Sync issues ─────────────────────────────────────────────────────────────

export interface PosSyncIssue {
  id: string;
  orderId: string | null;
  kind: PosSyncIssueKind;
  message: string;
  detail: Record<string, unknown> | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedByName: string | null;
}

export async function listSyncIssues(tenantId: string, options: { open?: boolean; limit?: number } = {}): Promise<PosSyncIssue[]> {
  const rows = await getDb()
    .select()
    .from(posSyncIssues)
    .where(and(eq(posSyncIssues.tenantId, tenantId), options.open ? isNull(posSyncIssues.resolvedAt) : undefined))
    .orderBy(desc(posSyncIssues.createdAt))
    .limit(Math.min(options.limit ?? 50, 200));
  return rows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    kind: r.kind,
    message: r.message,
    detail: r.detailJson ?? null,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    resolvedByName: r.resolvedByName,
  }));
}

export async function countOpenSyncIssues(tenantId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(posSyncIssues)
    .where(and(eq(posSyncIssues.tenantId, tenantId), isNull(posSyncIssues.resolvedAt)));
  return Number(row?.n ?? 0);
}

export async function resolveSyncIssue(tenantId: string, issueId: string, actorName: string): Promise<boolean> {
  const rows = await getDb()
    .update(posSyncIssues)
    .set({ resolvedAt: new Date(), resolvedByName: actorName.slice(0, 80) })
    .where(and(eq(posSyncIssues.id, issueId), eq(posSyncIssues.tenantId, tenantId), isNull(posSyncIssues.resolvedAt)))
    .returning({ id: posSyncIssues.id });
  return rows.length > 0;
}

/**
 * An offline sale the server couldn't record (e.g. a product was deleted, the shift
 * isn't this shop's). The money already changed hands, so the whole sale is kept here for
 * the owner and the device stops retrying. Idempotent per key.
 */
export async function recordRejectedOfflineSale(input: {
  tenantId: string;
  idempotencyKey: string;
  reason: string;
  sale: Record<string, unknown>;
}): Promise<void> {
  await getDb()
    .insert(posSyncIssues)
    .values({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey.slice(0, 64),
      kind: "rejected",
      message: `An offline sale couldn't be saved: ${input.reason}`.slice(0, 300),
      detailJson: input.sale,
    })
    .onConflictDoNothing();
}
