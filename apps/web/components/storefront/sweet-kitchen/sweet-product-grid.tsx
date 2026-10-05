"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { DemoProduct, DemoTenant } from "@/lib/demo-data";
import { useCart } from "@/lib/cart";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

function SweetProductCard({
  tenantSlug,
  product,
  accent,
  onAdd,
}: {
  tenantSlug: string;
  product: DemoProduct;
  accent: string;
  onAdd: () => void;
}) {
  return (
    <div className="glass-card group overflow-hidden rounded-2xl transition duration-500 hover:-translate-y-1 hover:shadow-[0_0_30px_rgba(255,0,127,0.15)]">
      <div className="relative aspect-square overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.image}
          alt={product.title}
          className="h-full w-full object-cover transition duration-700 group-hover:scale-110"
        />
        {product.category && (
          <span
            className="absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wider text-white"
            style={{ backgroundColor: accent }}
          >
            {product.category}
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-heading mb-1 text-lg font-semibold text-[#2d1b1b]">{product.title}</h3>
        {product.shortDescription && (
          <p className="mb-3 line-clamp-2 text-xs text-[#2d1b1b]/50">{product.shortDescription}</p>
        )}
        <div className="flex items-center justify-between">
          <span className="font-heading text-xl font-bold" style={{ color: accent }}>
            {formatPrice(product.price)}
          </span>
          <button
            type="button"
            onClick={onAdd}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:scale-110"
            style={{ backgroundColor: accent }}
            aria-label={`Add ${product.title}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <Link
          href={`/${tenantSlug}/products/${product.slug}`}
          className="mt-2 block text-center text-xs text-[#2d1b1b]/40 underline"
        >
          View details
        </Link>
      </div>
    </div>
  );
}

export function SweetProductGrid({ tenant }: { tenant: DemoTenant }) {
  const accent = tenant.shopTheme.primaryColor;
  const { addItem } = useCart(tenant.slug);
  const categories = useMemo(
    () => ["All", ...new Set(tenant.products.map((p) => p.category))],
    [tenant.products]
  );
  const [active, setActive] = useState("All");

  const filtered =
    active === "All" ? tenant.products : tenant.products.filter((p) => p.category === active);

  return (
    <section id="shop" className="relative px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 text-center">
          <p className="font-display text-3xl text-[#ff007f] md:text-4xl">Sweet treats & good eats</p>
          <h2 className="font-heading mt-2 text-3xl font-bold text-[#2d1b1b] md:text-4xl">The Shop</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-[#2d1b1b]/50">
            Homemade baked goods and local delicacies — fresh from the kitchen to yours.
          </p>
        </div>

        <div className="mb-8 flex flex-wrap justify-center gap-3">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActive(cat)}
              className={`rounded-full px-5 py-2 text-sm font-medium uppercase tracking-wide transition ${
                active === cat
                  ? "text-white shadow-[0_0_15px_rgba(255,0,127,0.4)]"
                  : "bg-[#ffd1dc]/20 text-[#2d1b1b]/60 hover:bg-[#ffd1dc]/40"
              }`}
              style={active === cat ? { backgroundColor: accent } : undefined}
            >
              {cat}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="py-16 text-center font-heading text-xl text-[#2d1b1b]/50">
            Products coming soon!
          </p>
        ) : (
          <div id="featured" className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map((product) => (
              <SweetProductCard
                key={product.id}
                tenantSlug={tenant.slug}
                product={product}
                accent={accent}
                onAdd={() =>
                  addItem({
                    productId: product.id,
                    slug: product.slug,
                    title: product.title,
                    price: product.price,
                    image: product.image,
                  })
                }
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
