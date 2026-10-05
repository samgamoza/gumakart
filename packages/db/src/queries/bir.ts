import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  orderItems,
  orderReturns,
  orders,
  posInvoiceCounters,
  posZReadings,
  registerSessions,
  registers,
  tenants,
} from "../schema/index";
import type { TenantBirSettings, TenantSettingsJson } from "../types/tenant-settings";
import type { SaleTotals } from "../types/pos-tax";

/**
 * Phase 11 — BIR-ready POS, OFF by default.
 *
 * What it does when a shop turns it on (with its own PTU details):
 *  - every POS sale gets a sequential sales invoice number per register (never reused,
 *    assigned inside the sale's transaction);
 *  - the receipt prints the registered name, TIN, address, MIN, serial and PTU numbers;
 *  - X reading (per shift, no reset) and Z reading (end of day, numbered, with the
 *    accumulated grand total before and after);
 *  - an e-journal export (CSV) of every POS receipt.
 *
 * What it does NOT claim: BIR accreditation of Guma Kart as a CAS/POS provider, or that
 * a shop is compliant. The owner turns it on only after their accountant/RDO review and
 * PTU; the settings page says so. Invoices are numbered only while it's on; the series
 * per register never restarts.
 */

export const BIR_REQUIRED: Array<{ key: keyof TenantBirSettings; label: string }> = [
  { key: "registeredName", label: "Registered name" },
  { key: "tin", label: "TIN" },
  { key: "address", label: "Registered address" },
  { key: "min", label: "MIN (machine ID)" },
  { key: "serialNo", label: "Serial number" },
  { key: "ptuNo", label: "PTU number" },
];

export function birMissing(bir: TenantBirSettings | null | undefined): string[] {
  return BIR_REQUIRED.filter((f) => !String(bir?.[f.key] ?? "").trim()).map((f) => f.label);
}

export function birActive(settings: TenantSettingsJson | null | undefined): TenantBirSettings | null {
  const bir = settings?.pos?.bir;
  return bir?.enabled && birMissing(bir).length === 0 ? bir : null;
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function formatInvoiceNumber(prefix: string | null | undefined, n: number): string {
  return `${(prefix ?? "").trim().toUpperCase().slice(0, 12)}${String(n).padStart(10, "0")}`;
}

/** Next sales invoice number for a register (locks the counter row; call inside the sale tx). */
export async function nextInvoiceNumberInTx(tx: Tx, tenantId: string, registerId: string, prefix?: string | null): Promise<string> {
  await tx.insert(posInvoiceCounters).values({ registerId, tenantId, prefix: prefix ?? "" }).onConflictDoNothing();
  const [counter] = await tx.select().from(posInvoiceCounters).where(eq(posInvoiceCounters.registerId, registerId)).for("update");
  const n = counter!.nextInvoice;
  await tx.update(posInvoiceCounters).set({ nextInvoice: n + 1 }).where(eq(posInvoiceCounters.registerId, registerId));
  return formatInvoiceNumber(prefix, n);
}

// ─── Readings ────────────────────────────────────────────────────────────────

export interface ReadingTotals {
  transactions: number;
  grossSales: number;
  regularDiscounts: number;
  seniorDiscounts: number;
  pwdDiscounts: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  returns: number;
  returnCount: number;
  voids: number;
  voidCount: number;
  netSales: number;
  cash: number;
  gcash: number;
  maya: number;
  card: number;
  firstInvoice: string | null;
  lastInvoice: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

async function totalsFor(tenantId: string, where: { shiftIds: string[] }): Promise<ReadingTotals> {
  const db = getDb();
  const empty: ReadingTotals = {
    transactions: 0, grossSales: 0, regularDiscounts: 0, seniorDiscounts: 0, pwdDiscounts: 0, vatableSales: 0, vatAmount: 0,
    vatExemptSales: 0, zeroRatedSales: 0, returns: 0, returnCount: 0, voids: 0, voidCount: 0, netSales: 0, cash: 0, gcash: 0,
    maya: 0, card: 0, firstInvoice: null, lastInvoice: null,
  };
  if (where.shiftIds.length === 0) return empty;
  const sales = await db
    .select({ subtotal: orders.subtotal, total: orders.total, meta: orders.posMetaJson, voidedAt: orders.voidedAt, invoice: orders.invoiceNumber })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.sourceChannel, "pos"), inArray(orders.registerSessionId, where.shiftIds)))
    .orderBy(asc(orders.createdAt));
  const t = { ...empty };
  const invoices: string[] = [];
  for (const s of sales) {
    if (s.invoice) invoices.push(s.invoice);
    if (s.voidedAt) continue;
    const meta = (s.meta ?? {}) as { totals?: SaleTotals; discountType?: string; paidByMethod?: Record<string, number> };
    const totals = meta.totals;
    t.transactions += 1;
    t.grossSales += Number(s.subtotal);
    const disc = totals?.discountAmount ?? 0;
    if (meta.discountType === "senior") t.seniorDiscounts += disc;
    else if (meta.discountType === "pwd") t.pwdDiscounts += disc;
    else t.regularDiscounts += disc;
    if (totals?.vatExempt) t.vatExemptSales += totals.vatExemptSales ?? totals.total;
    else {
      t.vatableSales += totals?.netOfVat ?? 0;
      t.vatAmount += totals?.vatAmount ?? 0;
    }
    t.netSales += Number(s.total);
    for (const m of ["cash", "gcash", "maya", "card"] as const) t[m] += Number(meta.paidByMethod?.[m] ?? 0);
  }
  const rets = await db
    .select({ kind: orderReturns.kind, amount: orderReturns.refundAmount, collected: orderReturns.collectedAmount })
    .from(orderReturns)
    .where(and(eq(orderReturns.tenantId, tenantId), inArray(orderReturns.registerSessionId, where.shiftIds)));
  for (const r of rets) {
    if (r.kind === "void") {
      t.voids += Number(r.amount);
      t.voidCount += 1;
    } else {
      t.returns += Number(r.amount) - Number(r.collected);
      t.returnCount += 1;
    }
  }
  t.netSales -= t.returns;
  for (const k of Object.keys(t) as Array<keyof ReadingTotals>) {
    if (typeof t[k] === "number") (t as unknown as Record<string, number>)[k] = r2(t[k] as number);
  }
  invoices.sort();
  t.firstInvoice = invoices[0] ?? null;
  t.lastInvoice = invoices[invoices.length - 1] ?? null;
  return t;
}

export interface XReading {
  shiftId: string;
  registerName: string;
  openedAt: Date;
  closedAt: Date | null;
  totals: ReadingTotals;
  generatedAt: Date;
}

/** X reading: one shift, any time, changes nothing. */
export async function getXReading(tenantId: string, shiftId: string): Promise<XReading | null> {
  const [shift] = await getDb()
    .select({ id: registerSessions.id, openedAt: registerSessions.openedAt, closedAt: registerSessions.closedAt, registerName: registers.name })
    .from(registerSessions)
    .innerJoin(registers, eq(registers.id, registerSessions.registerId))
    .where(and(eq(registerSessions.id, shiftId), eq(registerSessions.tenantId, tenantId)))
    .limit(1);
  if (!shift) return null;
  return {
    shiftId,
    registerName: shift.registerName,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt,
    totals: await totalsFor(tenantId, { shiftIds: [shiftId] }),
    generatedAt: new Date(),
  };
}

export class BirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BirError";
  }
}

export interface ZReading {
  id: string;
  zNumber: number;
  fromAt: Date | null;
  toAt: Date;
  fromInvoice: string | null;
  toInvoice: string | null;
  totals: ReadingTotals;
  grandTotalBefore: number;
  grandTotalAfter: number;
  createdByName: string;
  createdAt: Date;
}

function toZ(row: typeof posZReadings.$inferSelect): ZReading {
  return {
    id: row.id,
    zNumber: row.zNumber,
    fromAt: row.fromAt,
    toAt: row.toAt,
    fromInvoice: row.fromInvoice,
    toInvoice: row.toInvoice,
    totals: row.totalsJson as unknown as ReadingTotals,
    grandTotalBefore: Number(row.grandTotalBefore),
    grandTotalAfter: Number(row.grandTotalAfter),
    createdByName: row.createdByName,
    createdAt: row.createdAt,
  };
}

/**
 * Z reading: closes the day for a register. Covers every shift closed since the last Z,
 * numbers the reading, and moves the accumulated grand total forward. All shifts on the
 * register must be closed first.
 */
export async function createZReading(tenantId: string, registerId: string, actorName: string): Promise<ZReading> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [reg] = await tx.select({ id: registers.id }).from(registers).where(and(eq(registers.id, registerId), eq(registers.tenantId, tenantId))).limit(1);
    if (!reg) throw new BirError("Register not found.");
    await tx.insert(posInvoiceCounters).values({ registerId, tenantId }).onConflictDoNothing();
    const [counter] = await tx.select().from(posInvoiceCounters).where(eq(posInvoiceCounters.registerId, registerId)).for("update");
    const [open] = await tx
      .select({ id: registerSessions.id })
      .from(registerSessions)
      .where(and(eq(registerSessions.registerId, registerId), eq(registerSessions.status, "open")))
      .limit(1);
    if (open) throw new BirError("Close the open shift first, then run the Z reading.");

    const now = new Date();
    const shifts = await tx
      .select({ id: registerSessions.id })
      .from(registerSessions)
      .where(
        and(
          eq(registerSessions.registerId, registerId),
          eq(registerSessions.status, "closed"),
          counter!.lastZAt ? gt(registerSessions.closedAt, counter!.lastZAt) : undefined,
          lte(registerSessions.closedAt, now)
        )
      );
    const totals = await totalsFor(tenantId, { shiftIds: shifts.map((s) => s.id) });
    const before = Number(counter!.grandTotal);
    const after = r2(before + totals.netSales);
    const [row] = await tx
      .insert(posZReadings)
      .values({
        tenantId,
        registerId,
        zNumber: counter!.nextZ,
        fromAt: counter!.lastZAt,
        toAt: now,
        fromInvoice: totals.firstInvoice,
        toInvoice: totals.lastInvoice,
        totalsJson: totals as unknown as Record<string, number>,
        grandTotalBefore: before.toFixed(2),
        grandTotalAfter: after.toFixed(2),
        createdByName: actorName.slice(0, 80),
      })
      .returning();
    await tx
      .update(posInvoiceCounters)
      .set({ nextZ: counter!.nextZ + 1, lastZAt: now, grandTotal: after.toFixed(2) })
      .where(eq(posInvoiceCounters.registerId, registerId));
    return toZ(row!);
  });
}

export async function listZReadings(tenantId: string, limit = 60): Promise<ZReading[]> {
  const rows = await getDb()
    .select()
    .from(posZReadings)
    .where(eq(posZReadings.tenantId, tenantId))
    .orderBy(desc(posZReadings.createdAt))
    .limit(Math.min(limit, 365));
  return rows.map(toZ);
}

/** Shifts closed since the last Z on each register (to show "Z reading due"). */
export async function zReadingStatus(tenantId: string): Promise<Array<{ registerId: string; registerName: string; pendingShifts: number; openShift: boolean; lastZAt: Date | null; nextZ: number }>> {
  const db = getDb();
  const regs = await db
    .select({ id: registers.id, name: registers.name, lastZAt: posInvoiceCounters.lastZAt, nextZ: posInvoiceCounters.nextZ })
    .from(registers)
    .leftJoin(posInvoiceCounters, eq(posInvoiceCounters.registerId, registers.id))
    .where(eq(registers.tenantId, tenantId));
  const out = [];
  for (const r of regs) {
    const [pending] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(registerSessions)
      .where(
        and(
          eq(registerSessions.registerId, r.id),
          eq(registerSessions.status, "closed"),
          r.lastZAt ? gt(registerSessions.closedAt, r.lastZAt) : undefined
        )
      )) as [{ n: number }];
    const [open] = await db
      .select({ id: registerSessions.id })
      .from(registerSessions)
      .where(and(eq(registerSessions.registerId, r.id), eq(registerSessions.status, "open")))
      .limit(1);
    out.push({ registerId: r.id, registerName: r.name, pendingShifts: pending.n, openShift: Boolean(open), lastZAt: r.lastZAt, nextZ: r.nextZ ?? 1 });
  }
  return out;
}

// ─── E-journal ───────────────────────────────────────────────────────────────

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Every POS receipt in [from, to) as CSV (one row per receipt, items joined). Max 92 days. */
export async function posEJournalCsv(tenantId: string, from: Date, to: Date): Promise<string> {
  if (to.getTime() - from.getTime() > 92 * 86_400_000) throw new BirError("Export up to 92 days at a time.");
  const db = getDb();
  const rows = await db
    .select({
      id: orders.id,
      createdAt: orders.createdAt,
      orderNumber: orders.orderNumber,
      invoice: orders.invoiceNumber,
      subtotal: orders.subtotal,
      discount: orders.discount,
      tax: orders.tax,
      total: orders.total,
      refunded: orders.refundedAmount,
      voidedAt: orders.voidedAt,
      offlineAt: orders.posOfflineAt,
      meta: orders.posMetaJson,
    })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.sourceChannel, "pos"), gt(orders.createdAt, from), sql`${orders.createdAt} <= ${to.toISOString()}::timestamptz`))
    .orderBy(asc(orders.createdAt))
    .limit(50_000);
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db.select({ orderId: orderItems.orderId, title: orderItems.titleSnapshot, qty: orderItems.quantity, unit: orderItems.unitPrice }).from(orderItems).where(inArray(orderItems.orderId, ids))
    : [];
  const byOrder = new Map<string, string[]>();
  for (const i of items) {
    const list = byOrder.get(i.orderId) ?? [];
    list.push(`${i.qty}x ${i.title} @${Number(i.unit).toFixed(2)}`);
    byOrder.set(i.orderId, list);
  }
  const header = ["date_time", "invoice_no", "order_no", "cashier", "items", "gross", "discount", "discount_type", "vatable_sales", "vat", "vat_exempt", "total", "refunded", "voided", "tenders", "rung_offline"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const meta = (r.meta ?? {}) as { cashierName?: string; discountType?: string; totals?: SaleTotals; tenders?: Array<{ method: string; amount: number }> };
    const t = meta.totals;
    lines.push(
      [
        new Date(r.createdAt.getTime() + 8 * 3600_000).toISOString().replace("T", " ").slice(0, 19),
        r.invoice ?? "",
        r.orderNumber,
        meta.cashierName ?? "",
        (byOrder.get(r.id) ?? []).join("; "),
        Number(r.subtotal).toFixed(2),
        Number(r.discount ?? 0).toFixed(2),
        meta.discountType ?? "none",
        t && !t.vatExempt ? t.netOfVat.toFixed(2) : "0.00",
        Number(r.tax ?? 0).toFixed(2),
        t?.vatExempt ? (t.vatExemptSales ?? t.total).toFixed(2) : "0.00",
        Number(r.total).toFixed(2),
        Number(r.refunded ?? 0).toFixed(2),
        r.voidedAt ? "yes" : "",
        (meta.tenders ?? []).map((x) => `${x.method}:${Number(x.amount).toFixed(2)}`).join(" "),
        r.offlineAt ? "yes" : "",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** BIR header for receipts, or null when the shop hasn't turned it on. */
export async function getBirReceiptHeader(tenantId: string): Promise<(TenantBirSettings & { vatRegistered: boolean }) | null> {
  const [t] = await getDb().select({ settings: tenants.settingsJson }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const settings = t?.settings as TenantSettingsJson | null | undefined;
  const bir = birActive(settings);
  return bir ? { ...bir, vatRegistered: Boolean(settings?.pos?.vatRegistered) } : null;
}

