"use client";

import { sizedImageUrl } from "@/lib/image-sizes";
import Link from "next/link";
import { Flame, Mail, MapPin, Phone, ShoppingBag, Star, UtensilsCrossed } from "lucide-react";
import type { DemoTenant } from "@/lib/demo-data";
import { useCart } from "@/lib/cart";
import { SarabHeroImage } from "./sarab-hero-image";
import { splitSarabBrand } from "./sarab-utils";
import type { StoreLook } from "@gumakart/storefront-themes";
import { isFoodBusinessCategory, normalizeStoreLook } from "@gumakart/storefront-themes";

function sarabIsFoodShop(tenant: DemoTenant): boolean {
  return isFoodBusinessCategory(tenant.category || "Food & Beverage");
}

export function SarabTopbar({ tenant }: { tenant: DemoTenant }) {
  const food = sarabIsFoodShop(tenant);
  const promo =
    tenant.shopTheme.promoTitle ||
    (food ? "Free Delivery Today!" : "Book a consultation today");
  return (
    <div className="sarab-topbar">
      <div className="sarab-container sarab-topbar-inner">
        <div>
          {tenant.location && (
            <span>
              <MapPin size={12} /> {tenant.location}
            </span>
          )}
          <span>
            <Mail size={12} /> {food ? "Order online — fast checkout" : "Message us — we reply fast"}
          </span>
        </div>
        <span className="sarab-ttag">
          <Flame size={10} style={{ display: "inline", marginRight: 4 }} />
          {promo}
        </span>
      </div>
    </div>
  );
}

export function SarabNavbar({ tenant }: { tenant: DemoTenant }) {
  const { items, ready } = useCart(tenant.slug);
  const cartCount = items.reduce((sum, item) => sum + item.qty, 0);
  const { lead, accent } = splitSarabBrand(tenant.name);
  const checkoutHref = `/${tenant.slug}/checkout`;
  const homeHref = `/${tenant.slug}`;
  const menuHref = `/${tenant.slug}#menu`;
  const orderHref = ready && cartCount > 0 ? checkoutHref : menuHref;

  return (
    <nav className="sarab-nav">
      <div className="sarab-container sarab-nav-inner">
        <Link href={homeHref} className="sarab-blogo">
          {tenant.logoUrl ? (
            <img src={sizedImageUrl(tenant.logoUrl, 160)} alt={tenant.name} decoding="async" className="h-11 w-auto object-contain" />
          ) : (
            <>
              <div className="sarab-bico">
                <UtensilsCrossed size={20} />
              </div>
              <div>
                <div className="sarab-bname">
                  {lead}
                  <span>{accent}</span>
                </div>
                <div className="sarab-bsub">{tenant.category || "Shop"}</div>
              </div>
            </>
          )}
        </Link>
        <div className="sarab-nav-actions">
          <Link href={checkoutHref} className="sarab-cart-btn" aria-label="Cart">
            <ShoppingBag size={22} />
            {ready && cartCount > 0 && (
              <span className="sarab-cart-count">{cartCount > 99 ? "99+" : cartCount}</span>
            )}
          </Link>
          <Link href={orderHref} className="sarab-nav-cta">
            <ShoppingBag size={16} />
            {ready && cartCount > 0
              ? "Checkout"
              : sarabIsFoodShop(tenant)
                ? "Order Now"
                : "View offers"}
          </Link>
        </div>
      </div>
    </nav>
  );
}

export function SarabHero({
  tenant,
  look: lookProp,
}: {
  tenant: DemoTenant;
  look?: StoreLook;
}) {
  const look = normalizeStoreLook(lookProp ?? tenant.shopTheme.storeLook);
  const fallback =
    "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&q=80";
  // Prefer cover, then each product photo (newest first) so a broken upload
  // falls through to the next product instead of an empty hero circle.
  const heroSources = [
    tenant.coverUrl,
    ...tenant.products.map((p) => p.image),
    fallback,
  ].filter((src, i, arr): src is string => Boolean(src) && arr.indexOf(src) === i);
  const tagline = tenant.tagline || tenant.shopTheme.tagline;
  const food = sarabIsFoodShop(tenant);

  return (
    <section className={`sarab-hero sarab-hero--${look.heroLayout}`} id="hero">
      <div className="sarab-hbgtxt">{food ? "FOOD" : "SHOP"}</div>
      <div className="sarab-container sarab-hero-grid">
        <div>
          <div className="sarab-hbadge">
            <div className="sarab-hbadge-icon">
              <Star size={14} fill="currentColor" />
            </div>
            <span>
              {tenant.shopTheme.promoSubtitle ||
                (food ? "Fresh flavors · Fast delivery" : "Trusted guidance · Local support")}
            </span>
          </div>
          <h1 className="sarab-htitle">
            {food ? (
              <>
                Delicious <span className="hl">Food</span>
                <br />
                from {tenant.name}
              </>
            ) : (
              <>
                Welcome to <span className="hl">{tenant.name}</span>
              </>
            )}
          </h1>
          <p className="sarab-hdesc">{tagline}</p>
          <Link href={`/${tenant.slug}#menu`} className="sarab-btn-red">
            <UtensilsCrossed size={18} />
            {food ? "Explore Menu" : "Explore offers"}
          </Link>
        </div>
        <div className="sarab-hcircle-wrap">
          <div className="sarab-hcircle">
            <SarabHeroImage sources={heroSources} alt={tenant.name} />
          </div>
          {look.floatCards === "on" ? (
            <>
              <div className="sarab-fcard fc1">
                <Flame size={16} color="#e8281a" />
                <div>
                  <span className="sarab-fcnum">{food ? "Hot Deal" : "Featured"}</span>
                  <span className="sarab-fcsm">{food ? "Order today" : "Ask today"}</span>
                </div>
              </div>
              <div className="sarab-fcard fc2">
                <Star size={16} color="#f6a623" fill="#f6a623" />
                <div>
                  <span className="sarab-fcnum">4.9/5</span>
                  <span className="sarab-fcsm">Customer rated</span>
                </div>
              </div>
              <div className="sarab-fcard fc3">
                <Phone size={16} color="#2d6a4f" />
                <div>
                  <span className="sarab-fcnum">Fast</span>
                  <span className="sarab-fcsm">{food ? "Delivery" : "Response"}</span>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function SarabMarquee({ tenant }: { tenant?: DemoTenant }) {
  const food = !tenant || sarabIsFoodShop(tenant);
  const items = food
    ? [
        "Crispy Fried Chicken",
        "Gourmet Burgers",
        "Artisan Pizzas",
        "Fresh Wraps & Rolls",
        "Loaded Fries",
        "Ice Cream Shakes",
        "Grilled Sandwiches",
      ]
    : [
        tenant?.category || "Professional services",
        "Clear options",
        "Local support",
        "Trusted guidance",
        "Book a consultation",
        "Plans that fit",
      ];
  const track = [...items, ...items];
  return (
    <div className="sarab-mqsec">
      <div className="sarab-mqtrack">
        {track.map((item, i) => (
          <div key={`${item}-${i}`} className="sarab-mqitem">
            <span>●</span>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
