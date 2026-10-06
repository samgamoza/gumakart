"use client";

import { sizedImageUrl } from "@/lib/image-sizes";
import Image from "next/image";
import Link from "next/link";
import {
  Bike,
  Menu,
  Phone,
  Shield,
  ShoppingCart,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { DemoProduct, DemoTenant } from "@/lib/demo-data";
import { useCart } from "@/lib/cart";
import { shopPublicUrl, shopPublicUrlLabel } from "@/lib/utils";
import {
  MOTTO_FEATURE_STRIP,
  MOTTO_HERO_IMAGES,
  formatMottoPrice,
  mottoBrandName,
  mottoStarRating,
} from "./motto-utils";

const PRODUCT_TABS = [
  { id: "all", label: "All Gear" },
  { id: "new", label: "New Arrivals" },
  { id: "featured", label: "On Sale" },
  { id: "bestseller", label: "Top Sellers" },
] as const;

type TabId = (typeof PRODUCT_TABS)[number]["id"];

function MottoProductCard({
  tenantSlug,
  product,
}: {
  tenantSlug: string;
  product: DemoProduct;
}) {
  const { addItem, ready } = useCart(tenantSlug);
  const [adding, setAdding] = useState(false);
  const productHref = `/${tenantSlug}/products/${product.slug}`;
  const stars = mottoStarRating(product.id);
  const badge = product.tags.includes("new")
    ? "New"
    : product.tags.includes("bestseller")
      ? "Hot"
      : null;

  async function handleAdd() {
    setAdding(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    addItem({
      productId: product.id,
      slug: product.slug,
      title: product.title,
      price: product.price,
      image: product.image,
    });
    setAdding(false);
  }

  return (
    <article className="mt-product-card">
      <div className="mt-product-image">
        <Link href={productHref}>
          <Image src={product.image} alt={product.title} width={320} height={320} />
        </Link>
        {badge && (
          <span className={`mt-product-badge ${badge === "New" ? "new" : ""}`}>{badge}</span>
        )}
      </div>
      <div className="mt-product-body">
        <Link href={productHref} className="mt-product-cat">
          {product.category}
        </Link>
        <Link href={productHref} className="mt-product-title">
          {product.title}
        </Link>
        {product.compareAtPrice && product.compareAtPrice > product.price && (
          <del className="mt-price-old">{formatMottoPrice(product.compareAtPrice)}</del>
        )}
        <span className="mt-price-new">{formatMottoPrice(product.price)}</span>
      </div>
      <div className="mt-product-footer">
        <button type="button" className="mt-btn mt-btn-dark" onClick={handleAdd} disabled={!ready || adding}>
          {adding ? "Adding…" : "Add To Cart"}
        </button>
        <div className="mt-stars" aria-label={`${stars} out of 5 stars`}>
          {"★".repeat(stars)}
          {"☆".repeat(5 - stars)}
        </div>
      </div>
    </article>
  );
}

export function MottoHeader({ tenant }: { tenant: DemoTenant }) {
  const { items, ready, subtotal } = useCart(tenant.slug);
  const cartCount = items.reduce((total, item) => total + item.qty, 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const brand = mottoBrandName(tenant.name);
  const homeHref = `/${tenant.slug}`;
  const checkoutHref = `/${tenant.slug}/checkout`;
  const phone =
    tenant.storeSettings.whatsapp.enabled && tenant.storeSettings.whatsapp.phone
      ? tenant.storeSettings.whatsapp.phone
      : null;

  return (
    <header className="mt-header">
      <div className="mt-container mt-header-inner">
        <Link href={homeHref} className="mt-logo">
          {tenant.logoUrl ? (
            <img src={sizedImageUrl(tenant.logoUrl, 160)} alt={tenant.name} decoding="async" className="h-9 w-auto object-contain" />
          ) : (
            <>
              <Bike className="mt-logo-icon h-8 w-8" />
              {brand}
            </>
          )}
        </Link>

        <nav className="mt-nav" aria-label="Main navigation">
          <Link href={homeHref}>Home</Link>
          <a href="#products">Shop</a>
          <a href="#categories">Categories</a>
          <a href="#footer">Contact</a>
        </nav>

        <div className="mt-header-actions">
          <Link href={checkoutHref} className="mt-cart-btn" aria-label="Cart">
            <ShoppingCart className="h-5 w-5" />
            {ready && cartCount > 0 && <span className="mt-cart-badge">{cartCount}</span>}
          </Link>
          <Link href={checkoutHref} className="mt-cart-total">
            {formatMottoPrice(subtotal)}
          </Link>
          <button
            type="button"
            className="mt-mobile-toggle"
            aria-label="Toggle menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="mt-container mt-mobile-menu md:hidden">
          <Link href={homeHref} onClick={() => setMenuOpen(false)}>
            Home
          </Link>
          <a href="#products" onClick={() => setMenuOpen(false)}>
            Shop
          </a>
          <a href="#categories" onClick={() => setMenuOpen(false)}>
            Categories
          </a>
          <Link href={checkoutHref} onClick={() => setMenuOpen(false)}>
            Cart ({cartCount})
          </Link>
          {phone && (
            <a href={`tel:${phone}`} onClick={() => setMenuOpen(false)}>
              {phone}
            </a>
          )}
        </div>
      )}
    </header>
  );
}

export function MottoHero({ tenant }: { tenant: DemoTenant }) {
  const featured = tenant.products[0];
  const heroImage =
    tenant.coverUrl ||
    featured?.image ||
    MOTTO_HERO_IMAGES[0]!;
  const promoTitle = tenant.shopTheme.promoTitle ?? "Ride Bold";
  const promoSubtitle = tenant.shopTheme.promoSubtitle ?? tenant.tagline;

  return (
    <section className="mt-hero">
      <div className="mt-hero-grid">
        <div className="mt-hero-text">
          <div>
            <span className="mt-hero-kicker">{tenant.category || "Moto Gear"}</span>
            <h1 className="mt-hero-title">{promoTitle}</h1>
            <strong className="mt-hero-sub">{tenant.name}</strong>
            <span className="mt-hero-accent">{tenant.tagline}</span>
            <p className="mt-hero-desc">{promoSubtitle}</p>
            <div className="flex flex-wrap gap-3">
              <Link href="#products" className="mt-btn">
                Shop Now
              </Link>
              {featured && (
                <Link href={`/${tenant.slug}/products/${featured.slug}`} className="mt-btn mt-btn-outline">
                  View Featured
                </Link>
              )}
            </div>
          </div>
        </div>
        <div className="mt-hero-visual">
          <Image
            src={heroImage}
            alt={featured?.title ?? tenant.name}
            width={720}
            height={560}
            className="h-full min-h-[320px] w-full object-cover"
            priority
          />
        </div>
      </div>
    </section>
  );
}

export function MottoCategories({ tenant }: { tenant: DemoTenant }) {
  const categories = useMemo(() => {
    if (tenant.shopCategories.length > 0) {
      return tenant.shopCategories.slice(0, 4).map((cat, index) => ({
        id: cat.id,
        label: cat.name,
        desc: `${tenant.products.filter((p) => p.category === cat.name).length} items`,
        num: String(index + 1).padStart(2, "0"),
      }));
    }
    return MOTTO_FEATURE_STRIP.map((item, index) => ({
      id: item.id,
      label: item.label,
      desc: item.desc,
      num: String(index + 1).padStart(2, "0"),
    }));
  }, [tenant]);

  return (
    <section className="mt-categories" id="categories" aria-label="Shop categories">
      <div className="mt-categories-grid">
        {categories.map((cat) => (
          <a key={cat.id} href="#products" className="mt-category-item">
            <span className="mt-category-num">{cat.num}</span>
            <span className="mt-category-label">{cat.label}</span>
            <p className="mt-category-desc">{cat.desc}</p>
          </a>
        ))}
      </div>
    </section>
  );
}

export function MottoProducts({ tenant }: { tenant: DemoTenant }) {
  const [tab, setTab] = useState<TabId>("all");

  const filtered = useMemo(() => {
    switch (tab) {
      case "new":
        return tenant.products.filter((p) => p.tags.includes("new"));
      case "featured":
        return tenant.products.filter(
          (p) => p.compareAtPrice && p.compareAtPrice > p.price
        );
      case "bestseller":
        return tenant.products.filter((p) => p.tags.includes("bestseller"));
      default:
        return tenant.products;
    }
  }, [tenant.products, tab]);

  const display = filtered.length > 0 ? filtered : tenant.products;

  return (
    <section className="mt-products" id="products">
      <div className="mt-container">
        <div className="mt-section-head">
          <h2>
            Moto <span>Gear</span>
          </h2>
          <p>
            Premium helmets, jackets, gloves, and riding accessories — built for the road.
          </p>
        </div>

        <div className="mt-tabs" role="tablist">
          {PRODUCT_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`mt-tab ${tab === item.id ? "active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {display.length === 0 ? (
          <p className="text-center text-[var(--mt-muted)]">No products yet — check back soon.</p>
        ) : (
          <div className="mt-product-grid">
            {display.map((product) => (
              <MottoProductCard key={product.id} tenantSlug={tenant.slug} product={product} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function MottoFooter({ tenant }: { tenant: DemoTenant }) {
  const brand = mottoBrandName(tenant.name);
  const phone =
    tenant.storeSettings.whatsapp.enabled && tenant.storeSettings.whatsapp.phone
      ? tenant.storeSettings.whatsapp.phone
      : null;
  const siteUrl = shopPublicUrl(tenant.slug);
  const siteLabel = shopPublicUrlLabel(tenant.slug);
  const categories = tenant.shopCategories.length
    ? tenant.shopCategories
    : [...new Set(tenant.products.map((p) => p.category))].slice(0, 6).map((name, i) => ({
        id: `f-${i}`,
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
      }));

  return (
    <footer className="mt-footer" id="footer">
      <div className="mt-container">
        <div className="mt-footer-grid">
          <div>
            <h3>{brand}</h3>
            <ul className="mt-footer-links">
              <li>{tenant.location}</li>
              {phone && (
                <li>
                  <a href={`tel:${phone}`}>
                    <Phone className="mr-1 inline h-4 w-4" />
                    {phone}
                  </a>
                </li>
              )}
              <li>
                <a href={siteUrl} target="_blank" rel="noreferrer">
                  {siteLabel}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h3>Categories</h3>
            <ul className="mt-footer-links">
              {categories.map((cat) => (
                <li key={cat.id}>
                  <a href="#products">{cat.name}</a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Shop</h3>
            <ul className="mt-footer-links">
              <li>
                <Link href={`/${tenant.slug}`}>Home</Link>
              </li>
              <li>
                <a href="#products">All Products</a>
              </li>
              <li>
                <Link href={`/${tenant.slug}/checkout`}>Checkout</Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div className="mt-footer-bar">
        <div className="mt-container">
          <Shield className="mr-1 inline h-4 w-4" />
          &copy; {new Date().getFullYear()} <span>{tenant.name}</span>. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
