"use client";

import Link from "next/link";
import { MessageCircle, ShoppingBag } from "lucide-react";
import type { DemoTenant } from "@/lib/demo-data";
import { useCart } from "@/lib/cart";
import { whatsappChatUrl } from "@/lib/storefront-settings";
import { ShopAssistant } from "@/components/storefront/shop-assistant";
import { StorefrontOwnerMenu } from "@/components/storefront/storefront-owner-menu";
import { displayFontStack } from "@/components/storefront/theme-shell";
import { storefrontUrl } from "@/lib/utils";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export function ShopShell({
  tenant,
  children,
}: {
  tenant: DemoTenant;
  children: React.ReactNode;
}) {
  const { count: cartCount, subtotal: cartTotal } = useCart(tenant.slug);

  const accent = tenant.shopTheme?.primaryColor ?? tenant.theme.primaryColor;
  const fontStack = tenant.shopTheme ? displayFontStack(tenant.shopTheme) : undefined;

  return (
    <div
      className="min-h-screen bg-white text-neutral-900"
      style={fontStack ? ({ ["--font-bricolage" as string]: fontStack } as React.CSSProperties) : undefined}
    >
      <header className="sticky top-0 z-50 border-b border-neutral-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-8 md:py-5">
          <Link href={`/${tenant.slug}`} className="min-w-0 flex-1">
            {tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenant.logoUrl}
                alt={tenant.name}
                className="h-10 w-auto max-w-[220px] object-contain md:h-12"
              />
            ) : (
              <span className="block truncate font-display text-xl font-bold tracking-tight md:text-3xl">
                {tenant.name}
              </span>
            )}
          </Link>

          <div className="flex shrink-0 items-center gap-2 md:gap-3">
            <Link
              href={`/${tenant.slug}/checkout`}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 transition hover:bg-neutral-50"
              aria-label="Cart"
            >
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 && (
                <span
                  className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                  style={{ backgroundColor: accent }}
                >
                  {cartCount}
                </span>
              )}
            </Link>

            <StorefrontOwnerMenu tenantSlug={tenant.slug} variant="classic" />
          </div>
        </div>
      </header>

      {children}

      {tenant.storeSettings.shopAssistant.enabled ||
      tenant.storeSettings.shopAssistant.humanInbox !== false ? (
        <ShopAssistant
          tenantSlug={tenant.slug}
          shopName={tenant.name}
          assistant={tenant.storeSettings.shopAssistant}
          whatsappUrl={
            tenant.storeSettings.whatsapp.enabled && tenant.storeSettings.whatsapp.phone
              ? whatsappChatUrl(
                  tenant.storeSettings.whatsapp.phone,
                  `${tenant.storeSettings.whatsapp.greeting}\n\n${storefrontUrl}/${tenant.slug}`
                )
              : null
          }
        />
      ) : null}

      {tenant.storeSettings.whatsapp.enabled && tenant.storeSettings.whatsapp.phone && (
        <a
          href={
            whatsappChatUrl(
              tenant.storeSettings.whatsapp.phone,
              `${tenant.storeSettings.whatsapp.greeting}\n\n${storefrontUrl}/${tenant.slug}`
            ) ?? "#"
          }
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-24 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition hover:scale-105 md:bottom-8"
          style={{ backgroundColor: "#25D366" }}
          aria-label="Chat on WhatsApp"
        >
          <MessageCircle className="h-7 w-7" />
        </a>
      )}

      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-neutral-200 bg-white/95 p-4 backdrop-blur-md safe-bottom">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div>
              <p className="text-xs text-neutral-500">{cartCount} in cart</p>
              <p className="text-lg font-bold">{formatPrice(cartTotal)}</p>
            </div>
            <Link
              href={`/${tenant.slug}/checkout`}
              className="rounded-full px-8 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
              style={{ backgroundColor: accent, boxShadow: `0 8px 20px -6px ${accent}66` }}
            >
              Checkout
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
