"use client";

import { sizedImageUrl } from "@/lib/image-sizes";
import Link from "next/link";
import { useState } from "react";
import { Heart, Menu, Search, ShoppingBag, Sparkles } from "lucide-react";
import { useCart } from "@/lib/cart";
import { useStorefrontExperience } from "./storefront-experience-context";

export function ExperienceHeader() {
  const { tenant, search, setSearch, activeCategory, setActiveCategory } =
    useStorefrontExperience();
  const { count: cartCount } = useCart(tenant.slug);
  const [menuOpen, setMenuOpen] = useState(false);

  const categories =
    tenant.shopCategories.length > 0
      ? tenant.shopCategories
      : [...new Set(tenant.products.map((p) => p.category))].map((name) => ({
          id: name,
          name,
          slug: name.toLowerCase().replace(/\s+/g, "-"),
        }));

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-4">
        <Link
          href={`/${tenant.slug}`}
          className="flex min-w-0 shrink-0 items-center gap-2"
          aria-label={`${tenant.name} home`}
        >
          {tenant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sizedImageUrl(tenant.logoUrl, 140)}
              alt=""
              decoding="async"
              className="h-9 w-auto max-w-[140px] object-contain"
            />
          ) : (
            <>
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <span className="text-lg">{tenant.logoEmoji}</span>
              </span>
              <span className="hidden truncate font-display text-xl font-bold tracking-tight text-foreground sm:block">
                {tenant.name}
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${tenant.name}…`}
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="Search products"
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

        <Link
          href={`/${tenant.slug}/checkout`}
          aria-label={`Cart, ${cartCount} items`}
          className="relative flex size-10 items-center justify-center rounded-full bg-foreground text-background transition-transform active:scale-95"
        >
          <ShoppingBag className="size-5" />
          {cartCount > 0 && (
            <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[0.65rem] font-bold text-primary-foreground">
              {cartCount}
            </span>
          )}
        </Link>

        <button
          type="button"
          aria-label="Menu"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted md:hidden"
        >
          <Menu className="size-5" />
        </button>
      </div>

      {categories.length > 0 && (
        <nav className="mx-auto max-w-6xl px-4 pb-3" aria-label="Product categories">
          <ul className="no-scrollbar flex items-center gap-2 overflow-x-auto">
            <li>
              <button
                type="button"
                onClick={() => setActiveCategory(null)}
                className={
                  "whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium transition-colors " +
                  (activeCategory === null
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:border-foreground/30 hover:bg-muted")
                }
              >
                ✨ All
              </button>
            </li>
            {categories.map((cat) => (
              <li key={cat.id}>
                <button
                  type="button"
                  onClick={() => setActiveCategory(cat.slug)}
                  className={
                    "whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium transition-colors " +
                    (activeCategory === cat.slug
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:border-foreground/30 hover:bg-muted")
                  }
                >
                  {cat.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {menuOpen && (
        <div className="border-t border-border bg-background px-4 py-3 md:hidden">
          <p className="font-display text-lg font-bold">{tenant.name}</p>
          <p className="text-sm text-muted-foreground">{tenant.tagline}</p>
        </div>
      )}
    </header>
  );
}
