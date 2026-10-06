"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Droplets,
  MapPin,
  Menu,
  Phone,
  Plus,
  Scissors,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DemoProduct, DemoTenant } from "@/lib/demo-data";
import { useCart } from "@/lib/cart";
import {
  formatHaircutPrice,
  haircutBrandName,
  haircutPhone,
  HAIRCUT_HERO_SLIDES,
  serviceIconForProduct,
} from "./haircut-utils";
import { sizedImageUrl } from "@/lib/image-sizes";

const ICONS = {
  scissors: Scissors,
  razor: Scissors,
  sparkles: Sparkles,
  droplets: Droplets,
} as const;

export function HaircutHeader({ tenant }: { tenant: DemoTenant }) {
  const { items, ready } = useCart(tenant.slug);
  const cartCount = items.reduce((total, item) => total + item.qty, 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const homeHref = `/${tenant.slug}`;
  const checkoutHref = `/${tenant.slug}/checkout`;
  const brand = haircutBrandName(tenant.name);

  return (
    <header className="hc-header">
      <div className="hc-container hc-header-inner">
        <Link href={homeHref} className="hc-logo">
          {tenant.logoUrl ? (
            <Image src={tenant.logoUrl} alt={tenant.name} width={120} height={40} className="h-10 w-auto object-contain" />
          ) : (
            <>
              <Scissors className="h-6 w-6" />
              {brand}
            </>
          )}
        </Link>

        <nav className="hc-nav" aria-label="Primary">
          <Link href={homeHref}>Home</Link>
          <a href="#about">About</a>
          <a href="#services">Services</a>
          <a href="#pricing">Pricing</a>
          <a href="#footer">Contact</a>
        </nav>

        <div className="hc-header-actions">
          <Link href={checkoutHref} className="hc-btn hc-book-desktop">
            Appointment
            <ArrowRight className="h-4 w-4" />
          </Link>
          <span className="text-sm text-[var(--hc-light)] lg:hidden">Book ({ready ? cartCount : 0})</span>
          <button
            type="button"
            className="hc-mobile-toggle"
            aria-label="Toggle menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="hc-container">
          <nav className="hc-mobile-menu" aria-label="Mobile">
            <Link href={homeHref} onClick={() => setMenuOpen(false)}>
              Home
            </Link>
            <a href="#about" onClick={() => setMenuOpen(false)}>
              About
            </a>
            <a href="#services" onClick={() => setMenuOpen(false)}>
              Services
            </a>
            <a href="#pricing" onClick={() => setMenuOpen(false)}>
              Pricing
            </a>
            <Link href={checkoutHref} onClick={() => setMenuOpen(false)}>
              Appointment ({cartCount})
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

export function HaircutHero({ tenant }: { tenant: DemoTenant }) {
  const [active, setActive] = useState(0);
  const phone = haircutPhone(tenant);
  const slides = useMemo(() => {
    const cover = tenant.coverUrl;
    const promo = tenant.shopTheme.promoTitle || tenant.name;
    if (!cover) return [...HAIRCUT_HERO_SLIDES];
    return [
      {
        title: promo,
        subtitle: tenant.shopTheme.promoSubtitle || tenant.tagline,
        image: cover,
      },
      ...HAIRCUT_HERO_SLIDES.slice(1),
    ];
  }, [tenant.coverUrl, tenant.name, tenant.shopTheme.promoSubtitle, tenant.shopTheme.promoTitle, tenant.tagline]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActive((index) => (index + 1) % slides.length);
    }, 6500);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  return (
    <section className="hc-hero" id="hero">
      {slides.map((slide, index) => (
        <div
          key={`${slide.image}-${index}`}
          className={`hc-hero-slide ${index === active ? "active" : ""}`}
          style={{ backgroundImage: `url(${sizedImageUrl(slide.image, 600)})` }}
          aria-hidden={index !== active}
        />
      ))}

      <div className="hc-hero-content">
        <div className="hc-container">
          <div className="hc-hero-copy">
            <h1>{slides[active]?.title}</h1>
            <div className="hc-hero-meta">
              <span>
                <MapPin className="h-4 w-4 text-[var(--hc-primary)]" />
                {tenant.location}
              </span>
              {phone && (
                <span>
                  <Phone className="h-4 w-4 text-[var(--hc-primary)]" />
                  {phone}
                </span>
              )}
            </div>
            <p className="mb-6 max-w-xl text-base text-white/85">{slides[active]?.subtitle}</p>
            <a href="#services" className="hc-btn">
              Book a service
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>

      <div className="hc-hero-controls">
        <button
          type="button"
          aria-label="Previous slide"
          onClick={() => setActive((index) => (index - 1 + slides.length) % slides.length)}
        >
          <ArrowLeft className="mx-auto h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Next slide"
          onClick={() => setActive((index) => (index + 1) % slides.length)}
        >
          <ArrowRight className="mx-auto h-4 w-4" />
        </button>
      </div>
    </section>
  );
}

export function HaircutAbout({ tenant }: { tenant: DemoTenant }) {
  const aboutImage =
    tenant.coverUrl ||
    tenant.products[0]?.image ||
    "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=900&q=80";

  return (
    <section className="hc-section" id="about">
      <div className="hc-container hc-about-grid">
        <div className="hc-about-visual">
          <Image src={aboutImage} alt={`About ${tenant.name}`} width={720} height={900} />
          <div className="hc-about-badge">
            <strong>Local</strong>
            <span>Craft & Care</span>
          </div>
        </div>
        <div>
          <p className="hc-eyebrow">About Us</p>
          <h2 className="hc-section-title">More Than Just A Haircut</h2>
          <p className="hc-section-lead">{tenant.tagline}</p>
          <p className="mt-4 hc-section-lead">
            {tenant.name} serves {tenant.location} with appointment-ready services — clean fades, classic cuts,
            color, and grooming packages you can book online.
          </p>
          <div className="hc-about-stats">
            <div>
              <h3>Walk-in friendly</h3>
              <p>Book ahead for peak hours, or message us for the next open chair.</p>
            </div>
            <div>
              <h3>Transparent pricing</h3>
              <p>Clear service rates — add your pick to cart and finish checkout in minutes.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HaircutServiceCard({ tenantSlug, product, index }: { tenantSlug: string; product: DemoProduct; index: number }) {
  const { addItem, ready } = useCart(tenantSlug);
  const [adding, setAdding] = useState(false);
  const productHref = `/${tenantSlug}/products/${product.slug}`;
  const iconKey = serviceIconForProduct(product, index);
  const Icon = ICONS[iconKey];

  async function handleBook() {
    setAdding(true);
    await new Promise((resolve) => setTimeout(resolve, 180));
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
    <article className="hc-service-card">
      <div className="hc-service-icon">
        <Icon className="h-6 w-6" />
      </div>
      <div className="hc-service-body">
        <h3>
          <Link href={productHref}>{product.title}</Link>
        </h3>
        <p>{product.shortDescription}</p>
        <div className="hc-service-price">From {formatHaircutPrice(product.price)}</div>
        <div className="hc-service-actions">
          <button type="button" className="hc-btn" onClick={handleBook} disabled={!ready || adding}>
            <Plus className="h-4 w-4" />
            {adding ? "Adding…" : "Book"}
          </button>
          <Link href={productHref} className="hc-btn hc-btn-outline">
            Details
          </Link>
        </div>
      </div>
    </article>
  );
}

export function HaircutServices({ tenant }: { tenant: DemoTenant }) {
  const products = tenant.products;

  return (
    <section className="hc-section" id="services">
      <div className="hc-container">
        <div className="hc-services-head">
          <p className="hc-eyebrow">Services</p>
          <h2 className="hc-section-title">What We Provide</h2>
          <p className="hc-section-lead mx-auto">
            Pick a service, add it to your appointment cart, and checkout when you&apos;re ready.
          </p>
        </div>

        {products.length === 0 ? (
          <p className="text-center text-[var(--hc-light)]">Services coming soon — message us to book.</p>
        ) : (
          <div className="hc-service-grid">
            {products.map((product, index) => (
              <HaircutServiceCard key={product.id} tenantSlug={tenant.slug} product={product} index={index} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function HaircutPricing({ tenant }: { tenant: DemoTenant }) {
  const products = tenant.products.slice(0, 8);

  return (
    <section className="hc-section hc-pricing" id="pricing">
      <div className="hc-container">
        <div className="hc-services-head">
          <p className="hc-eyebrow">Pricing Plan</p>
          <h2 className="hc-section-title">Check Out Our Prices</h2>
        </div>
        {products.length === 0 ? (
          <p className="text-center text-[var(--hc-light)]">Pricing will appear once services are published.</p>
        ) : (
          <div className="hc-price-grid">
            {products.map((product) => (
              <div key={product.id} className="hc-price-row">
                <strong>{product.title}</strong>
                <span>{formatHaircutPrice(product.price)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function HaircutFooter({ tenant }: { tenant: DemoTenant }) {
  const homeHref = `/${tenant.slug}`;
  const checkoutHref = `/${tenant.slug}/checkout`;
  const phone = haircutPhone(tenant);
  const year = new Date().getFullYear();

  return (
    <footer className="hc-footer" id="footer">
      <div className="hc-container">
        <div className="hc-footer-grid">
          <div>
            <h5>{tenant.name}</h5>
            <p>{tenant.tagline}</p>
            <p className="mt-3">{tenant.location}</p>
            {phone && <p className="mt-2">{phone}</p>}
          </div>
          <div>
            <h5>Shop</h5>
            <ul>
              <li>
                <Link href={homeHref}>Home</Link>
              </li>
              <li>
                <a href="#about">About</a>
              </li>
              <li>
                <a href="#services">Services</a>
              </li>
              <li>
                <a href="#pricing">Pricing</a>
              </li>
            </ul>
          </div>
          <div>
            <h5>Book</h5>
            <ul>
              <li>
                <a href="#services">Browse services</a>
              </li>
              <li>
                <Link href={checkoutHref}>Complete appointment</Link>
              </li>
              <li>
                <a href="#footer">Contact</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="hc-footer-bottom">
          <p>
            © {tenant.name} {year}. All rights reserved.
          </p>
          <p>Powered by Guma One</p>
        </div>
      </div>
    </footer>
  );
}
