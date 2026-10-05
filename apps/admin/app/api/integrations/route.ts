import { NextResponse } from "next/server";
import {
  getTenantSettings,
  listApiTokens,
  listMarketplaceAccounts,
  listSocialAccounts,
  listWebhookEndpoints,
} from "@gumakart/db";
import { getIntegrationChecks, marketplaceConfigured, metaConfigured, type IntegrationId } from "@gumakart/services";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

/**
 * Phase 15 — Apps & integrations directory: what's on for this shop, what can be set up now,
 * and what's built but waiting for Guma Kart's provider keys. Nothing here claims a partnership:
 * tools without a built-in connection are marked "works through webhooks / API".
 */
type Status = "on" | "available" | "waiting" | "via_api";

interface Item {
  id: string;
  name: string;
  description: string;
  status: Status;
  detail?: string;
  href: string;
  ownerOnly?: boolean;
}

export async function GET() {
  try {
    const session = await requireTenantSession();
    const checks = new Map(getIntegrationChecks().map((c) => [c.id, c]));
    const ready = (id: IntegrationId) => Boolean(checks.get(id)?.configured);
    const owner = session.shopRole === "owner";
    const [settings, socials, markets, webhooks, keys] = await Promise.all([
      getTenantSettings(session.tenantId),
      listSocialAccounts(session.tenantId).catch(() => []),
      listMarketplaceAccounts(session.tenantId).catch(() => []),
      owner ? listWebhookEndpoints(session.tenantId) : Promise.resolve([]),
      owner ? listApiTokens(session.tenantId) : Promise.resolve([]),
    ]);
    const s = (settings?.settings ?? {}) as Record<string, any>;
    const receiving = (s.payments?.receiving ?? {}) as Record<string, string | undefined>;
    const tracking = (s.tracking ?? {}) as Record<string, string | undefined>;
    const liveSocial = socials.filter((a) => a.status === "connected" || a.status === "mock");
    const market = (p: "shopee" | "lazada") => markets.find((m) => m.platform === p && (m.status === "connected" || m.status === "mock"));
    const activeHooks = webhooks.filter((w) => w.active).length;
    const activeKeys = keys.filter((k) => !k.revokedAt && (!k.expiresAt || new Date(k.expiresAt) > new Date())).length;

    const groups: Array<{ id: string; label: string; items: Item[] }> = [
      {
        id: "payments",
        label: "Payments",
        items: [
          { id: "gcash-maya", name: "GCash & Maya (send to number)", description: "Buyers send to your number and upload proof; you confirm.", status: receiving.gcashNumber || receiving.mayaNumber ? "on" : "available", href: "/settings/payments" },
          { id: "bank", name: "Bank transfer", description: "Show your bank details at checkout.", status: receiving.bankAccountNumber ? "on" : "available", href: "/settings/payments" },
          { id: "paymongo", name: "PayMongo — cards, GCash, Maya, QR Ph", description: "Paid automatically, no proof to check.", status: ready("paymongo") ? "available" : "waiting", detail: ready("paymongo") ? undefined : "Turns on when Guma Kart's PayMongo account is live.", href: "/settings/payments" },
        ],
      },
      {
        id: "messaging",
        label: "Messaging",
        items: [
          { id: "sms", name: "SMS updates & campaigns", description: "Order updates, reminders and campaigns texted to buyers.", status: ready("semaphore") ? "on" : "waiting", detail: ready("semaphore") ? undefined : "Turns on when Guma Kart's SMS sender is approved.", href: "/automations" },
          { id: "email", name: "Email receipts", description: "Order and POS receipts by email when the buyer gives one.", status: ready("email") ? "on" : "waiting", href: "/automations" },
          { id: "meta", name: "Messenger & Instagram chats", description: "Reply to chats and send checkout links from Guma Kart.", status: liveSocial.length ? "on" : metaConfigured() ? "available" : "waiting", detail: liveSocial.length ? liveSocial.map((a) => a.name).join(", ") : metaConfigured() ? undefined : "Turns on after Meta approves Guma Kart.", href: "/inbox" },
        ],
      },
      {
        id: "channels",
        label: "Sales channels",
        items: [
          { id: "shopee", name: "Shopee", description: "One stock count; paid Shopee orders come in by themselves.", status: market("shopee") ? "on" : marketplaceConfigured("shopee") ? "available" : "waiting", detail: market("shopee")?.name, href: "/channels" },
          { id: "lazada", name: "Lazada", description: "One stock count; paid Lazada orders come in by themselves.", status: market("lazada") ? "on" : marketplaceConfigured("lazada") ? "available" : "waiting", detail: market("lazada")?.name, href: "/channels" },
          { id: "tiktok", name: "TikTok, Facebook & Instagram links", description: "Tagged links so every sale shows where it came from.", status: "available", href: "/channels" },
        ],
      },
      {
        id: "delivery",
        label: "Delivery",
        items: [
          { id: "lalamove", name: "Lalamove", description: "Book a rider from the order.", status: ready("lalamove") ? "available" : "waiting", href: "/settings/delivery-shipping" },
          { id: "grab", name: "GrabExpress", description: "Book a rider from the order.", status: ready("grab") ? "available" : "waiting", href: "/settings/delivery-shipping" },
        ],
      },
      {
        id: "marketing",
        label: "Ads & analytics",
        items: [
          { id: "fb-pixel", name: "Facebook / Meta Pixel", description: "Measure ads: views, add to cart, purchases.", status: tracking.facebookPixelId ? "on" : "available", href: "/settings/tracking" },
          { id: "tiktok-pixel", name: "TikTok Pixel", description: "Measure TikTok ads.", status: tracking.tiktokPixelId ? "on" : "available", href: "/settings/tracking" },
          { id: "ga4", name: "Google Analytics 4", description: "Visitors and sales in Google Analytics.", status: tracking.googleAnalyticsId ? "on" : "available", href: "/settings/tracking" },
        ],
      },
      {
        id: "automation",
        label: "Automation & your own tools",
        items: [
          { id: "zapier", name: "Zapier, Make or n8n", description: "Send new orders, payments and stock changes to 1,000s of apps. Add their webhook URL here.", status: activeHooks ? "on" : "via_api", detail: activeHooks ? `${activeHooks} webhook${activeHooks === 1 ? "" : "s"} on` : undefined, href: "/developers?tab=webhooks", ownerOnly: true },
          { id: "sheets", name: "Google Sheets", description: "A row per order — through Zapier/Make, or a Google Apps Script webhook.", status: "via_api", href: "/developers?tab=docs", ownerOnly: true },
          { id: "accounting", name: "Accounting (Xero, QuickBooks, your bookkeeper)", description: "CSV exports of orders, products and daily sales in Reports, or sync through the API.", status: "available", href: "/reports" },
          { id: "api", name: "Your own app or website", description: "Read orders, products, stock and buyers; update packing and stock.", status: activeKeys ? "on" : "via_api", detail: activeKeys ? `${activeKeys} active key${activeKeys === 1 ? "" : "s"}` : undefined, href: "/developers", ownerOnly: true },
        ],
      },
    ];
    return NextResponse.json({ ok: true, groups, owner });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[integrations]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
