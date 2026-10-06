"use client";

import { sizedImageUrl } from "@/lib/image-sizes";
import Link from "next/link";
import { useState } from "react";
import { Heart, Search, ShoppingBag, Sparkles } from "lucide-react";
import { StorefrontOwnerMenu } from "@/components/storefront/storefront-owner-menu";
import { useTenantV0Cart } from "./tenant-cart-provider";

export function TenantV0Header({
  shopName,
  shopSlug,
  logoUrl,
  logoEmoji,
  categories,
  search,
  onSearchChange,
}: {
  shopName: string;
  shopSlug: string;
  logoUrl?: string;
  logoEmoji: string;
  categories: Array<{ id: string; label: string; emoji?: string }>;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const { count, openCart } = useTenantV0Cart();
  const [activeCat, setActiveCat] = useState("all");

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-4">
        <Link href={`/${shopSlug}`} className="flex shrink-0 items-center gap-2" aria-label={`${shopName} home`}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sizedImageUrl(logoUrl, 160)} alt="" decoding="async" className="h-9 w-auto max-w-[160px] object-contain" />
          ) : (
            <>
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <span className="text-base">{logoEmoji}</span>
              </span>
              <span className="hidden font-display text-xl font-bold tracking-tight text-foreground sm:block">
                {shopName}
              </span>
            </>
          )}
        </Link>

        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex flex-1 items-center gap-2 rounded-full border border-border bg-muted/60 px-4 py-2 transition-colors focus-within:border-primary focus-within:bg-background"
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search products, brands & live shops"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-semibold text-primary sm:inline-flex">
            <Sparkles className="size-3" /> AI
          </span>
        </form>

        <button
          type="button"
          aria-label="Favorites"
          className="hidden size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted sm:flex"
        >
          <Heart className="size-5" />
        </button>

        <button
          type="button"
          onClick={openCart}
          aria-label={`Open cart, ${count} items`}
          className="relative flex size-10 items-center justify-center rounded-full bg-foreground text-background transition-transform active:scale-95"
        >
          <ShoppingBag className="size-5" />
          {count > 0 && (
            <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[0.65rem] font-bold text-primary-foreground">
              {count}
            </span>
          )}
        </button>

        <StorefrontOwnerMenu tenantSlug={shopSlug} variant="v0" />
      </div>

      {categories.length > 0 && (
        <nav className="mx-auto max-w-6xl px-4 pb-3" aria-label="Product categories">
          <ul className="no-scrollbar flex items-center gap-2 overflow-x-auto">
            {categories.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setActiveCat(c.id)}
                  className={
                    "whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium transition-colors " +
                    (activeCat === c.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:border-foreground/30 hover:bg-muted")
                  }
                >
                  {c.emoji ? `${c.emoji} ` : ""}
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
