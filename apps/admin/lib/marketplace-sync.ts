import {
  getMarketplaceAccount,
  importMarketplaceOrder,
  marketplaceStockPushPlan,
  recordStockPush,
  saveMarketplaceListings,
  updateMarketplaceAccount,
} from "@gumakart/db";
import {
  demoMarketplaceClient,
  lazadaClient,
  lazadaRefresh,
  listingKey,
  marketplaceConfigured,
  openToken,
  sealToken,
  shopeeClient,
  shopeeRefresh,
  type MarketplaceClient,
  type MarketplaceTokens,
} from "@gumakart/services";

/**
 * Phase 13: one sync round for a Shopee/Lazada shop.
 *   1. push Guma stock to every linked listing whose count differs;
 *   2. import paid orders changed since the last pull (cancellations restock).
 * Pushing first means a unit sold online here disappears from the marketplace before the
 * next order pull. Safe to run every 5 minutes; errors are kept on the account.
 */

type Account = NonNullable<Awaited<ReturnType<typeof getMarketplaceAccount>>>;

async function clientFor(account: Account): Promise<MarketplaceClient | null> {
  if (account.status === "mock") return demoMarketplaceClient(account.platform);
  if (!marketplaceConfigured(account.platform)) return null;
  const raw = await openToken(account.tokensSealed);
  if (!raw) return null;
  let tokens = JSON.parse(raw) as { accessToken: string; refreshToken: string; expiresAt: string };
  // Refresh a little early (Shopee access tokens last ~4 h, Lazada's longer).
  if (new Date(tokens.expiresAt).getTime() - Date.now() < 30 * 60_000) {
    const fresh: MarketplaceTokens = account.platform === "shopee" ? await shopeeRefresh(tokens.refreshToken, account.shopExternalId) : await lazadaRefresh(tokens.refreshToken);
    tokens = { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken, expiresAt: fresh.expiresAt.toISOString() };
    await updateMarketplaceAccount(account.tenantId, account.id, { tokensSealed: await sealToken(JSON.stringify(tokens)), tokenExpiresAt: fresh.expiresAt });
  }
  return account.platform === "shopee" ? shopeeClient({ shopId: account.shopExternalId, accessToken: tokens.accessToken }) : lazadaClient({ accessToken: tokens.accessToken });
}

export interface SyncSummary {
  pushed: number;
  pushFailed: number;
  imported: number;
  cancelled: number;
  unlinked: string[];
  oversold: string[];
  listingsRefreshed?: number;
  error?: string;
}

export async function syncMarketplaceAccount(account: Account, options: { refreshListings?: boolean } = {}): Promise<SyncSummary> {
  const summary: SyncSummary = { pushed: 0, pushFailed: 0, imported: 0, cancelled: 0, unlinked: [], oversold: [] };
  try {
    const client = await clientFor(account);
    if (!client) {
      summary.error = "Not connected — reconnect this shop in Channels.";
      await updateMarketplaceAccount(account.tenantId, account.id, { status: "error", lastError: summary.error });
      return summary;
    }
    if (options.refreshListings && account.status !== "mock") {
      const items = await client.listItems();
      summary.listingsRefreshed = (await saveMarketplaceListings(account.tenantId, account.id, items)).saved;
    }
    if (account.syncStock) {
      const plan = await marketplaceStockPushPlan(account.tenantId, account.id);
      if (plan.length) {
        const res = await client.updateStock(plan);
        const failed = new Map(res.failed.map((f) => [f.key, f.error]));
        await recordStockPush(
          account.tenantId,
          account.id,
          plan.map((p) => ({ listingId: p.listingId, stock: p.stock, error: failed.get(listingKey(p.externalItemId, p.externalModelId)) ?? null }))
        );
        summary.pushed = res.ok.length;
        summary.pushFailed = res.failed.length;
      } else {
        await recordStockPush(account.tenantId, account.id, []);
      }
    }
    if (account.importOrders && account.status !== "mock") {
      const since = new Date((account.ordersCursorAt ?? account.connectedAt).getTime() - 5 * 60_000);
      const started = new Date();
      for (const order of await client.listOrders(since)) {
        const r = await importMarketplaceOrder(account.tenantId, { id: account.id, platform: account.platform }, order);
        if (r.status === "imported") {
          summary.imported += 1;
          summary.oversold.push(...r.short.map((s) => `${s.title} (by ${s.short})`));
        } else if (r.status === "cancelled") summary.cancelled += 1;
        else if (r.status === "unlinked") summary.unlinked.push(...r.titles);
      }
      await updateMarketplaceAccount(account.tenantId, account.id, { ordersCursorAt: started, lastOrderPullAt: started });
    }
    const problems = [
      summary.unlinked.length ? `Orders waiting — link these listings: ${[...new Set(summary.unlinked)].slice(0, 5).join(", ")}` : "",
      summary.oversold.length ? `Oversold: ${summary.oversold.slice(0, 5).join(", ")}` : "",
      summary.pushFailed ? `${summary.pushFailed} stock update(s) failed` : "",
    ].filter(Boolean);
    await updateMarketplaceAccount(account.tenantId, account.id, {
      lastError: problems.length ? problems.join(" · ") : null,
      ...(account.status === "error" ? { status: "connected" as const } : {}),
    });
  } catch (error) {
    summary.error = error instanceof Error ? error.message : "Sync failed";
    await updateMarketplaceAccount(account.tenantId, account.id, { lastError: summary.error });
  }
  return summary;
}
