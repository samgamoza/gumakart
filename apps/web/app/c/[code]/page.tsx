import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  bumpCheckoutLinkCounter,
  getCheckoutLinkByCode,
  getTenantStorefrontBySlug,
  isPaymentMethodEnabled,
  type PublicCheckoutLink,
} from "@gumakart/db";
import { LinkCheckout, type LinkCheckoutData, type LinkPaymentOption } from "@/components/link-checkout/link-checkout";
import { LinkUnavailable } from "@/components/link-checkout/link-unavailable";
import { closedLinkMessage } from "@/lib/checkout-link-guard";
import { resolveDelivery, resolveStorefrontSettings } from "@/lib/storefront-settings";
import { isPreviewBot, utmFromSearchParams } from "@/lib/utm";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const STOREFRONT_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3010";

function absolute(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith("http") ? url : `${STOREFRONT_URL}${url}`;
}

function linkHeadline(link: PublicCheckoutLink): string {
  const first = link.items[0]?.title ?? "Your order";
  return link.items.length > 1 ? `${first} + ${link.items.length - 1} more` : first;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const link = await getCheckoutLinkByCode(code);
  if (!link) return { title: "Checkout link", robots: { index: false } };
  const tenant = await getTenantStorefrontBySlug(link.tenantSlug);
  const shop = tenant?.name ?? "Guma Kart shop";
  const title = `${linkHeadline(link)} · ${shop}`;
  const image = absolute(link.items[0]?.imageUrl ?? null);
  const description = "Mag-order sa isang page. Walang app o account na kailangan.";
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "website", images: image ? [{ url: image }] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image ? [image] : undefined },
  };
}

const PAYMENT_LABELS: Record<string, { label: string; note: string }> = {
  gcash: { label: "GCash", note: "Ipadala sa GCash ng seller pagka-order" },
  paymaya: { label: "Maya", note: "Ipadala sa Maya ng seller pagka-order" },
  cod: { label: "Cash on delivery", note: "Magbayad ng cash pagdating ng order" },
  bank: { label: "Bank transfer", note: "Mag-transfer pagka-order, tapos ipadala ang resibo" },
  qrph: { label: "QR Ph", note: "I-scan at magbayad online" },
  card: { label: "Credit / debit card", note: "Magbayad online gamit ang card" },
};

export default async function CheckoutLinkPage({ params, searchParams }: PageProps) {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  const link = await getCheckoutLinkByCode(code);
  if (!link) {
    return <LinkUnavailable title="Walang ganitong link" message="Pakicheck ang link, o i-message ang seller para sa bago." />;
  }

  const tenant = await getTenantStorefrontBySlug(link.tenantSlug);
  const closed = closedLinkMessage(link) ?? (tenant ? null : "Hindi tumatanggap ng order ang shop na ito ngayon.");
  if (closed || !tenant) {
    return <LinkUnavailable title="Hindi na tumatanggap ng order ang link na ito" message={closed ?? ""} shopName={tenant?.name} />;
  }

  const ua = (await headers()).get("user-agent");
  if (!isPreviewBot(ua)) await bumpCheckoutLinkCounter(link.id, "view");

  const settings = resolveStorefrontSettings(
    tenant.settingsJson,
    tenant.currency,
    tenant.checkoutPublishedJson,
    tenant.shippingPublishedJson
  );

  const allowed = link.paymentMethods;
  const payments: LinkPaymentOption[] = (["gcash", "paymaya", "cod", "bank", "qrph", "card"] as const)
    .filter((m) => isPaymentMethodEnabled(settings.checkout, m))
    .filter((m) => m !== "cod" || settings.codEnabled)
    .filter((m) => !allowed || allowed.includes(m))
    .filter((m) => (m === "qrph" || m === "card" ? settings.payments.mode !== "manual_ewallet" : true))
    .map((id) => {
      const base = { id, ...PAYMENT_LABELS[id]! };
      // Harvest H6: name the bank (e.g. GoTyme, BPI) so buyers know where they're sending.
      const bank = settings.payments.receiving.bankName.trim();
      return id === "bank" && bank ? { ...base, label: `Bank transfer · ${bank.slice(0, 40)}` } : base;
    });

  const pickupAllowed = settings.delivery.pickupEnabled && link.deliveryMode !== "delivery";
  const deliveryAllowed = link.deliveryMode !== "pickup";

  const data: LinkCheckoutData = {
    code: link.code,
    shop: { name: tenant.name, slug: tenant.slug, logoUrl: tenant.logoUrl },
    items: link.items.map((item) => ({
      key: item.variantId ?? item.productId,
      productId: item.productId,
      title: item.title,
      variantTitle: item.variantTitle,
      price: Number(item.price),
      imageUrl: item.imageUrl,
      quantity: item.quantity,
      maxQuantity: item.trackInventory && item.stockQty != null ? Math.max(0, Math.min(99, item.stockQty)) : 99,
    })),
    allowQuantityEdit: link.allowQuantityEdit,
    delivery: deliveryAllowed,
    pickup: pickupAllowed,
    pickupAddress: settings.delivery.pickupAddress || null,
    payments,
    checkout: settings.checkout,
    couponCode: link.couponCode,
    minOrderAmount: settings.minOrderAmount,
    freeDeliveryAbove: deliveryAllowed ? resolveDelivery(1, settings).freeAbove ?? null : null,
    requireEmail: Boolean(settings.checkout.customer?.requireEmail),
    utm: utmFromSearchParams(query),
  };

  return <LinkCheckout data={data} />;
}
