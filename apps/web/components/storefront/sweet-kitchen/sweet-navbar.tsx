"use client";

import { sizedImageUrl } from "@/lib/image-sizes";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/lib/cart";
import { StorefrontOwnerMenu } from "@/components/storefront/storefront-owner-menu";

export function SweetNavbar({
  tenantSlug,
  shopName,
  logoUrl,
  accent,
}: {
  tenantSlug: string;
  shopName: string;
  logoUrl?: string;
  accent: string;
}) {
  const { count } = useCart(tenantSlug);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[#ffd1dc]/60 bg-[#fffdf5]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link href={`/${tenantSlug}`} className="min-w-0">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sizedImageUrl(logoUrl, 200)} alt={shopName} decoding="async" className="h-12 w-auto max-w-[200px] object-contain" />
          ) : (
            <span className="font-display text-3xl leading-none text-[#2d1b1b]">{shopName}</span>
          )}
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-[#2d1b1b]/60 md:flex">
          <Link href={`/${tenantSlug}#shop`} className="hover:text-[#ff007f]">
            Shop
          </Link>
          <Link href={`/${tenantSlug}#featured`} className="hover:text-[#ff007f]">
            Featured
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href={`/${tenantSlug}/checkout`}
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[#ffd1dc] transition hover:bg-[#ffd1dc]/30"
            aria-label="Cart"
          >
            <ShoppingBag className="h-5 w-5" />
            {count > 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                style={{ backgroundColor: accent }}
              >
                {count}
              </span>
            )}
          </Link>
          <StorefrontOwnerMenu tenantSlug={tenantSlug} variant="classic" />
        </div>
      </div>
    </header>
  );
}
