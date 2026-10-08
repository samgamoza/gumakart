import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  kycVerificationSessions,
  orders,
  paymentTransactions,
  tenantPayouts,
  tenantWallets,
  tenants,
  walletLedgerEntries,
  walletReconciliations,
} from "../schema/index";
import {
  computePlatformFeeCentavos,
  computeSellerNetCentavos,
  minAutoPayoutCentavos,
  walletClearanceHours,
} from "../wallet-fees";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function toCentavos(value: string | number): number {
  return Math.round(Number(value) * 100);
}

function fromCentavos(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/**
 * Security G2 (GK-6): the one place balances change. Locks the wallet row and
 * applies relative deltas, so overlapping jobs can't both read-then-write the
 * same number. A debit larger than the balance is never absorbed at ₱0: the
 * shortfall becomes `owedBalance`, which later credits pay down first.
 */
async function applyWalletDelta(
  tx: Tx,
  tenantId: string,
  delta: { availableC?: number; pendingC?: number; withdrawnC?: number }
): Promise<void> {
  await ensureTenantWallet(tx, tenantId);
  const [w] = await tx
    .select()
    .from(tenantWallets)
    .where(eq(tenantWallets.tenantId, tenantId))
    .for("update");
  if (!w) throw new Error("wallet row vanished");
  let available = toCentavos(w.availableBalance);
  let pending = toCentavos(w.pendingBalance);
  let owed = toCentavos(w.owedBalance);
  pending += delta.pendingC ?? 0;
  if (pending < 0) {
    // A pending credit that was already released: the rest comes from available.
    available += pending;
    pending = 0;
  }
  available += delta.availableC ?? 0;
  if (available > 0 && owed > 0) {
    const pay = Math.min(available, owed);
    available -= pay;
    owed -= pay;
  }
  if (available < 0) {
    owed += -available;
    available = 0;
  }
  await tx
    .update(tenantWallets)
    .set({
      availableBalance: fromCentavos(available),
      pendingBalance: fromCentavos(pending),
      owedBalance: fromCentavos(owed),
      ...(delta.withdrawnC ? { totalWithdrawn: sql`${tenantWallets.totalWithdrawn} + ${fromCentavos(delta.withdrawnC)}` } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tenantWallets.tenantId, tenantId));
}

/** Gateways where the platform actually holds the buyer's money. COD, manual transfers and gift cards never reach the wallet. */
const PLATFORM_HELD_GATEWAYS = new Set(["paymongo", "xendit"]);

async function ensureTenantWallet(db: Db | Tx, tenantId: string) {
  const [existing] = await db
    .select()
    .from(tenantWallets)
    .where(eq(tenantWallets.tenantId, tenantId))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(tenantWallets)
    .values({ tenantId })
    .returning();
  return created!;
}

export interface TenantWalletSummary {
  availableBalance: string;
  pendingBalance: string;
  totalWithdrawn: string;
  /** Owed to the platform after refunds that exceeded the balance (G2). */
  owedBalance: string;
}

export interface WalletLedgerItem {
  id: string;
  type: string;
  status: string;
  grossAmount: string;
  feeAmount: string;
  netAmount: string;
  description: string | null;
  orderId: string | null;
  availableAt: Date | null;
  createdAt: Date;
}

export interface TenantPayoutItem {
  id: string;
  amount: string;
  fee: string;
  method: string;
  destinationAccount: string;
  destinationName: string;
  status: string;
  autoTriggered: boolean;
  processedAt: Date | null;
  createdAt: Date;
}

export interface TenantWalletSettings {
  autoPayoutEnabled?: boolean;
  payoutMethod?: "gcash" | "maya" | "bank";
  payoutAccount?: string;
  payoutAccountName?: string;
  kycVerified?: boolean;
}

export function resolveWalletSettings(settingsJson: Record<string, unknown>): TenantWalletSettings {
  const wallet = settingsJson.wallet;
  if (!wallet || typeof wallet !== "object") return {};
  const w = wallet as Record<string, unknown>;
  return {
    autoPayoutEnabled: w.autoPayoutEnabled === true,
    payoutMethod:
      w.payoutMethod === "gcash" || w.payoutMethod === "maya" || w.payoutMethod === "bank"
        ? w.payoutMethod
        : undefined,
    payoutAccount: typeof w.payoutAccount === "string" ? w.payoutAccount : undefined,
    payoutAccountName:
      typeof w.payoutAccountName === "string" ? w.payoutAccountName : undefined,
    kycVerified: w.kycVerified === true,
  };
}

/**
 * Credit seller earnings when an order is paid. Idempotent (one sale credit per
 * order, enforced by a unique index). Security G2 (GK-6): only money the
 * platform actually received (a paid PayMongo/Xendit charge) is credited —
 * COD, seller-confirmed transfers and gift cards never create a balance that
 * could be paid out.
 */
export async function creditSaleForOrder(
  orderId: string,
  options?: { immediateAvailable?: boolean }
): Promise<{ credited: boolean; netAmount?: string; reason?: "not_platform_money" | "already" | "not_paid" | "nothing" }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) return { credited: false, reason: "not_paid" };
    if (order.paymentStatus !== "paid") return { credited: false, reason: "not_paid" };
    if (order.status === "refunded" || order.status === "cancelled") return { credited: false, reason: "not_paid" };

    const [charge] = await tx
      .select({ gateway: paymentTransactions.gateway, amount: paymentTransactions.amount })
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.orderId, orderId), eq(paymentTransactions.status, "paid")))
      .orderBy(sql`${paymentTransactions.paidAt} desc nulls last`)
      .limit(1);
    if (!charge || !PLATFORM_HELD_GATEWAYS.has(charge.gateway)) return { credited: false, reason: "not_platform_money" };

    // Fee on the goods, credited base capped at what the gateway actually
    // collected (a gift-card part was never collected by the platform).
    const subtotalCentavos = Math.max(0, Math.min(toCentavos(order.subtotal), toCentavos(charge.amount)));
    const feeCentavos = computePlatformFeeCentavos(subtotalCentavos);
    const netCentavos = computeSellerNetCentavos(subtotalCentavos);
    if (netCentavos <= 0) return { credited: false, reason: "nothing" };

    const immediate = options?.immediateAvailable === true;
    const paidAt = order.paidAt ?? new Date();
    const clearanceMs = walletClearanceHours() * 60 * 60 * 1000;
    const availableAt = immediate ? paidAt : new Date(paidAt.getTime() + clearanceMs);
    const status = immediate ? "available" : "pending";

    await ensureTenantWallet(tx, order.tenantId);

    const inserted = await tx
      .insert(walletLedgerEntries)
      .values({
        tenantId: order.tenantId,
        orderId: order.id,
        type: "sale_credit",
        status,
        grossAmount: fromCentavos(subtotalCentavos),
        feeAmount: fromCentavos(feeCentavos),
        netAmount: fromCentavos(netCentavos),
        description: `Order ${order.orderNumber} · sale credit`,
        reference: `sale:${order.id}`,
        availableAt,
      })
      .onConflictDoNothing()
      .returning({ id: walletLedgerEntries.id });
    if (!inserted.length) return { credited: false, reason: "already" };

    await applyWalletDelta(tx, order.tenantId, immediate ? { availableC: netCentavos } : { pendingC: netCentavos });

    // Record platform fee on the order for reporting.
    await tx
      .update(orders)
      .set({ serviceFee: fromCentavos(feeCentavos) })
      .where(eq(orders.id, order.id));

    return { credited: true, netAmount: fromCentavos(netCentavos) };
  });
}

/** Move a pending sale credit to available (e.g. order delivered or clearance elapsed). Exactly once: the status flip is a compare-and-swap. */
export async function releaseOrderSaleCredit(orderId: string): Promise<boolean> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .update(walletLedgerEntries)
      .set({ status: "available" })
      .where(
        and(
          eq(walletLedgerEntries.orderId, orderId),
          eq(walletLedgerEntries.type, "sale_credit"),
          eq(walletLedgerEntries.status, "pending")
        )
      )
      .returning({ tenantId: walletLedgerEntries.tenantId, netAmount: walletLedgerEntries.netAmount });
    if (!entry) return false;

    const netCentavos = toCentavos(entry.netAmount);
    await applyWalletDelta(tx, entry.tenantId, { pendingC: -netCentavos, availableC: netCentavos });
    return true;
  });
}

/** Cron: release pending credits whose clearance window has passed. */
export async function releaseExpiredPendingCredits(): Promise<number> {
  const db = getDb();
  const now = new Date();
  const pending = await db
    .select({ orderId: walletLedgerEntries.orderId })
    .from(walletLedgerEntries)
    .where(
      and(
        eq(walletLedgerEntries.type, "sale_credit"),
        eq(walletLedgerEntries.status, "pending"),
        lte(walletLedgerEntries.availableAt, now)
      )
    );

  let released = 0;
  for (const row of pending) {
    if (!row.orderId) continue;
    const ok = await releaseOrderSaleCredit(row.orderId);
    if (ok) released += 1;
  }
  return released;
}

/** Net already taken back from this order's credit by partial refunds (a negative number of centavos, or 0). */
async function refundDebitsSoFar(tx: Tx, orderId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${walletLedgerEntries.netAmount}), 0)` })
    .from(walletLedgerEntries)
    .where(and(eq(walletLedgerEntries.orderId, orderId), eq(walletLedgerEntries.type, "refund_debit")));
  return toCentavos(row?.total ?? 0);
}

/**
 * Security G2 (GK-6): a partial refund takes its share back out of the wallet.
 * `reference` makes it idempotent (one debit per return row). Debits what is
 * still credited for this order, at most the refunded amount; nothing happens
 * for orders the platform never credited (COD, manual, gift card).
 */
export async function debitWalletForRefund(
  orderId: string,
  refundCentavos: number,
  reference: string,
  description = "Partial refund"
): Promise<{ debited: number }> {
  if (!Number.isInteger(refundCentavos) || refundCentavos <= 0) return { debited: 0 };
  const db = getDb();
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(walletLedgerEntries)
      .where(
        and(
          eq(walletLedgerEntries.orderId, orderId),
          eq(walletLedgerEntries.type, "sale_credit"),
          inArray(walletLedgerEntries.status, ["pending", "available"])
        )
      )
      .limit(1)
      .for("update");
    if (!entry) return { debited: 0 };
    const remaining = toCentavos(entry.netAmount) + (await refundDebitsSoFar(tx, orderId));
    const debit = Math.min(Math.max(remaining, 0), refundCentavos);
    if (debit <= 0) return { debited: 0 };
    const inserted = await tx
      .insert(walletLedgerEntries)
      .values({
        tenantId: entry.tenantId,
        orderId,
        type: "refund_debit",
        status: "completed",
        grossAmount: fromCentavos(refundCentavos),
        feeAmount: "0.00",
        netAmount: fromCentavos(-debit),
        description,
        reference,
      })
      .onConflictDoNothing()
      .returning({ id: walletLedgerEntries.id });
    if (!inserted.length) return { debited: 0 }; // this return was already debited
    await applyWalletDelta(tx, entry.tenantId, entry.status === "pending" ? { pendingC: -debit } : { availableC: -debit });
    return { debited: debit };
  });
}

/** Reverse a sale credit when an order is fully refunded. Takes back whatever partial refunds left credited. */
export async function reverseSaleCreditForOrder(orderId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(walletLedgerEntries)
      .where(
        and(
          eq(walletLedgerEntries.orderId, orderId),
          eq(walletLedgerEntries.type, "sale_credit"),
          inArray(walletLedgerEntries.status, ["pending", "available"])
        )
      )
      .limit(1)
      .for("update");
    if (!entry) return;
    const wasPending = entry.status === "pending";
    await tx.update(walletLedgerEntries).set({ status: "cancelled" }).where(eq(walletLedgerEntries.id, entry.id));
    const remaining = toCentavos(entry.netAmount) + (await refundDebitsSoFar(tx, orderId));
    if (remaining <= 0) return;

    const inserted = await tx
      .insert(walletLedgerEntries)
      .values({
        tenantId: entry.tenantId,
        orderId: entry.orderId,
        type: "refund_debit",
        status: "completed",
        grossAmount: entry.grossAmount,
        feeAmount: "0.00",
        netAmount: fromCentavos(-remaining),
        description: `Refund reversal for order credit`,
        reference: `refund:full:${orderId}`,
      })
      .onConflictDoNothing()
      .returning({ id: walletLedgerEntries.id });
    if (!inserted.length) return;

    await applyWalletDelta(tx, entry.tenantId, wasPending ? { pendingC: -remaining } : { availableC: -remaining });
  });
}

export async function getWalletSummary(tenantId: string): Promise<TenantWalletSummary> {
  const db = getDb();
  const wallet = await ensureTenantWallet(db, tenantId);
  return {
    availableBalance: wallet.availableBalance,
    pendingBalance: wallet.pendingBalance,
    totalWithdrawn: wallet.totalWithdrawn,
    owedBalance: wallet.owedBalance,
  };
}

export async function listWalletLedger(
  tenantId: string,
  limit = 30
): Promise<WalletLedgerItem[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(walletLedgerEntries)
    .where(eq(walletLedgerEntries.tenantId, tenantId))
    .orderBy(desc(walletLedgerEntries.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    grossAmount: row.grossAmount,
    feeAmount: row.feeAmount,
    netAmount: row.netAmount,
    description: row.description,
    orderId: row.orderId,
    availableAt: row.availableAt,
    createdAt: row.createdAt,
  }));
}

export async function listTenantPayouts(
  tenantId: string,
  limit = 20
): Promise<TenantPayoutItem[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(tenantPayouts)
    .where(eq(tenantPayouts.tenantId, tenantId))
    .orderBy(desc(tenantPayouts.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    amount: row.amount,
    fee: row.fee,
    method: row.method,
    destinationAccount: row.destinationAccount,
    destinationName: row.destinationName,
    status: row.status,
    autoTriggered: row.autoTriggered,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
  }));
}

export class WalletError extends Error {
  constructor(
    message: string,
    public code:
      | "INSUFFICIENT_BALANCE"
      | "KYC_REQUIRED"
      | "PAYOUT_DESTINATION_REQUIRED"
      | "INVALID_AMOUNT"
      | "PAYOUTS_DISABLED"
  ) {
    super(message);
    this.name = "WalletError";
  }
}

/**
 * Payouts move real money. Until a disbursement provider is wired into
 * processQueuedPayouts, they stay off unless WALLET_PAYOUTS_ENABLED=true.
 */
export function walletPayoutsEnabled(): boolean {
  return process.env.WALLET_PAYOUTS_ENABLED?.trim().toLowerCase() === "true";
}

/** KYC truth is the latest session row (only platform review approves it). */
async function latestKycApproved(db: Db | Tx, tenantId: string): Promise<boolean> {
  const [latest] = await db
    .select({ status: kycVerificationSessions.status })
    .from(kycVerificationSessions)
    .where(eq(kycVerificationSessions.tenantId, tenantId))
    .orderBy(desc(kycVerificationSessions.createdAt))
    .limit(1);
  return latest?.status === "approved";
}

export async function requestTenantPayout(params: {
  tenantId: string;
  amountCentavos: number;
  method: "gcash" | "maya" | "bank";
  destinationAccount: string;
  destinationName: string;
  autoTriggered?: boolean;
}): Promise<{ payoutId: string }> {
  if (!walletPayoutsEnabled()) {
    throw new WalletError(
      "Payouts are not available yet — your balance stays safe in your wallet.",
      "PAYOUTS_DISABLED"
    );
  }
  if (!Number.isInteger(params.amountCentavos) || params.amountCentavos < 10000) {
    throw new WalletError("Minimum payout is ₱100.", "INVALID_AMOUNT");
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .select({ settingsJson: tenants.settingsJson })
      .from(tenants)
      .where(eq(tenants.id, params.tenantId))
      .limit(1);
    if (!tenant) throw new WalletError("Shop not found.", "INVALID_AMOUNT");

    if (!(await latestKycApproved(tx, params.tenantId))) {
      throw new WalletError(
        "Complete KYC verification before requesting a payout.",
        "KYC_REQUIRED"
      );
    }

    await ensureTenantWallet(tx, params.tenantId);
    // Lock the wallet so two concurrent requests can't both spend the balance.
    const [wallet] = await tx
      .select()
      .from(tenantWallets)
      .where(eq(tenantWallets.tenantId, params.tenantId))
      .for("update");
    if (!wallet) throw new WalletError("Wallet not found.", "INVALID_AMOUNT");
    if (toCentavos(wallet.owedBalance) > 0) {
      throw new WalletError("Refunds are still being recovered from this wallet — payouts resume once the balance is clear.", "INSUFFICIENT_BALANCE");
    }
    const availableCentavos = toCentavos(wallet.availableBalance);
    if (params.amountCentavos > availableCentavos) {
      throw new WalletError("Insufficient available balance.", "INSUFFICIENT_BALANCE");
    }

    const amount = fromCentavos(params.amountCentavos);
    const [payout] = await tx
      .insert(tenantPayouts)
      .values({
        tenantId: params.tenantId,
        amount,
        method: params.method,
        destinationAccount: params.destinationAccount,
        destinationName: params.destinationName,
        status: "queued",
        autoTriggered: params.autoTriggered ?? false,
      })
      .returning();

    await applyWalletDelta(tx, params.tenantId, { availableC: -params.amountCentavos });

    await tx.insert(walletLedgerEntries).values({
      tenantId: params.tenantId,
      payoutId: payout!.id,
      type: "payout",
      status: "pending",
      grossAmount: amount,
      feeAmount: "0.00",
      netAmount: fromCentavos(-params.amountCentavos),
      description: `Payout to ${params.method.toUpperCase()} ${params.destinationAccount}`,
      reference: `payout:${payout!.id}`,
    });

    return { payoutId: payout!.id };
  });
}

/**
 * Process queued payouts (simulated transfer — wire PayMongo/disbursement API here).
 * Security G2 (GK-6): each payout is claimed exactly once (queued → processing is a
 * compare-and-swap), so two overlapping settlement runs can't both send it.
 */
export async function processQueuedPayouts(limit = 50): Promise<number> {
  // Simulated transfer: never mark payouts "completed" unless explicitly enabled.
  if (!walletPayoutsEnabled()) return 0;
  const db = getDb();
  const queued = await db
    .select({ id: tenantPayouts.id })
    .from(tenantPayouts)
    .where(eq(tenantPayouts.status, "queued"))
    .orderBy(tenantPayouts.createdAt)
    .limit(limit);

  let processed = 0;
  for (const { id } of queued) {
    const now = new Date();
    const [claimed] = await db
      .update(tenantPayouts)
      .set({ status: "processing", claimedAt: now, attempts: sql`${tenantPayouts.attempts} + 1` })
      .where(and(eq(tenantPayouts.id, id), eq(tenantPayouts.status, "queued")))
      .returning();
    if (!claimed) continue; // another run has it

    await db.transaction(async (tx) => {
      const [done] = await tx
        .update(tenantPayouts)
        .set({ status: "completed", processedAt: now })
        .where(and(eq(tenantPayouts.id, claimed.id), eq(tenantPayouts.status, "processing")))
        .returning({ id: tenantPayouts.id });
      if (!done) return;
      await applyWalletDelta(tx, claimed.tenantId, { withdrawnC: toCentavos(claimed.amount) });
      await tx
        .update(walletLedgerEntries)
        .set({ status: "completed" })
        .where(
          and(
            eq(walletLedgerEntries.payoutId, claimed.id),
            eq(walletLedgerEntries.type, "payout")
          )
        );
    });
    processed += 1;
  }
  return processed;
}

/**
 * Security G2 (GK-6): nightly check that every wallet's balances equal what its
 * ledger says. Identity: available + pending − owed + payouts (queued/processing/
 * completed) = Σ sale credits (not cancelled) + Σ refund debits + Σ adjustments.
 * A mismatch is recorded, never auto-corrected.
 */
export async function reconcileWallets(tenantId?: string): Promise<{ checked: number; mismatched: number }> {
  const db = getDb();
  const wallets = tenantId
    ? await db.select().from(tenantWallets).where(eq(tenantWallets.tenantId, tenantId))
    : await db.select().from(tenantWallets);
  let mismatched = 0;
  for (const w of wallets) {
    const [sums] = await db
      .select({
        // A cancelled sale credit still counts: its reversal is the refund_debit row that cancelled it.
        credits: sql<string>`coalesce(sum(case when ${walletLedgerEntries.type} = 'sale_credit' then ${walletLedgerEntries.netAmount} else 0 end), 0)`,
        pendingCredits: sql<string>`coalesce(sum(case when ${walletLedgerEntries.type} = 'sale_credit' and ${walletLedgerEntries.status} = 'pending' then ${walletLedgerEntries.netAmount} else 0 end), 0)`,
        debits: sql<string>`coalesce(sum(case when ${walletLedgerEntries.type} in ('refund_debit', 'adjustment') then ${walletLedgerEntries.netAmount} else 0 end), 0)`,
        payouts: sql<string>`coalesce(sum(case when ${walletLedgerEntries.type} = 'payout' and ${walletLedgerEntries.status} <> 'cancelled' then -${walletLedgerEntries.netAmount} else 0 end), 0)`,
      })
      .from(walletLedgerEntries)
      .where(eq(walletLedgerEntries.tenantId, w.tenantId));
    const ledgerTotal = toCentavos(sums?.credits ?? 0) + toCentavos(sums?.debits ?? 0);
    const ledgerPending = toCentavos(sums?.pendingCredits ?? 0);
    const walletTotal =
      toCentavos(w.availableBalance) + toCentavos(w.pendingBalance) - toCentavos(w.owedBalance) + toCentavos(sums?.payouts ?? 0);
    const ok = walletTotal === ledgerTotal;
    if (!ok) mismatched += 1;
    await db.insert(walletReconciliations).values({
      tenantId: w.tenantId,
      ok,
      walletAvailable: w.availableBalance,
      walletPending: w.pendingBalance,
      walletOwed: w.owedBalance,
      ledgerAvailable: fromCentavos(ledgerTotal - ledgerPending),
      ledgerPending: fromCentavos(ledgerPending),
      note: ok ? null : `wallet ${fromCentavos(walletTotal)} vs ledger ${fromCentavos(ledgerTotal)} (payouts ${sums?.payouts ?? "0"})`,
    });
  }
  return { checked: wallets.length, mismatched };
}

/** Auto-request payouts for tenants with auto-payout enabled and enough balance. */
export async function processAutoPayouts(): Promise<number> {
  if (!walletPayoutsEnabled()) return 0;
  const db = getDb();
  const minCentavos = minAutoPayoutCentavos();
  const activeTenants = await db
    .select({
      id: tenants.id,
      settingsJson: tenants.settingsJson,
    })
    .from(tenants)
    .where(eq(tenants.status, "active"));

  let triggered = 0;
  for (const tenant of activeTenants) {
    const settings = resolveWalletSettings(
      (tenant.settingsJson ?? {}) as Record<string, unknown>
    );
    if (!settings.autoPayoutEnabled) continue;
    if (!(await latestKycApproved(db, tenant.id))) continue;
    if (!settings.payoutMethod || !settings.payoutAccount || !settings.payoutAccountName) {
      continue;
    }

    const summary = await getWalletSummary(tenant.id);
    const availableCentavos = toCentavos(summary.availableBalance);
    if (availableCentavos < minCentavos) continue;

    try {
      await requestTenantPayout({
        tenantId: tenant.id,
        amountCentavos: availableCentavos,
        method: settings.payoutMethod,
        destinationAccount: settings.payoutAccount,
        destinationName: settings.payoutAccountName,
        autoTriggered: true,
      });
      triggered += 1;
    } catch {
      // Skip tenants that fail validation mid-flight (race on balance, etc.)
    }
  }
  return triggered;
}

export async function runWalletSettlement(): Promise<{
  released: number;
  autoPayouts: number;
  processedPayouts: number;
  reconciliation: { checked: number; mismatched: number };
}> {
  const released = await releaseExpiredPendingCredits();
  const autoPayouts = await processAutoPayouts();
  const processedPayouts = await processQueuedPayouts();
  const reconciliation = await reconcileWallets();
  return { released, autoPayouts, processedPayouts, reconciliation };
}
