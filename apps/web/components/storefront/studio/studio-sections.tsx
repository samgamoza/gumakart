"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Aperture,
  ArrowRight,
  Camera,
  Eye,
  Menu,
  Printer,
  ShoppingBag,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DemoProduct, DemoTenant } from "@/lib/demo-data";
import { useCart } from "@/lib/cart";
import {
  formatStudioPrice,
  isPrintPackage,
  STUDIO_GALLERY_IMAGES,
  STUDIO_HERO_SLIDES,
  STUDIO_PACKAGE_TABS,
  STUDIO_SERVICES,
  studioBrandName,
  studioPackageUnit,
  studioPhone,
  type StudioPackageTabId,
} from "./studio-utils";
import { sizedImageUrl } from "@/lib/image-sizes";

const SERVICE_ICONS = {
  camera: Camera,
  aperture: Aperture,
  print: Printer,
} as const;

export function StudioHeader({ tenant }: { tenant: DemoTenant }) {
  const { items, ready } = useCart(tenant.slug);
  const cartCount = items.reduce((total, item) => total + item.qty, 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const homeHref = `/${tenant.slug}`;
  const checkoutHref = `/${tenant.slug}/checkout`;
  const brand = studioBrandName(tenant.name);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 48);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`st-header ${scrolled ? "scrolled" : ""}`}>
      <div className="st-container-fluid st-header-inner">
        <Link href={homeHref} className="st-logo">
          {tenant.logoUrl ? (
            <Image src={tenant.logoUrl} alt={tenant.name} width={120} height={40} className="h-10 w-auto object-contain" />
          ) : (
            brand
          )}
        </Link>

        <nav className="st-nav" aria-label="Primary">
          <Link href={homeHref}>Home</Link>
          <a href="#about">About</a>
          <a href="#gallery">Portfolio</a>
          <a href="#packages">Packages</a>
          <a href="#footer">Contact</a>
        </nav>

        <div className="st-header-actions">
          <Link href={checkoutHref} className="st-cart-link">
            <ShoppingBag className="h-4 w-4" />
            Book ({ready ? cartCount : 0})
          </Link>
          <button
            type="button"
            className="st-mobile-toggle"
            aria-label="Toggle menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="st-container-fluid">
          <nav className="st-mobile-menu" aria-label="Mobile">
            <Link href={homeHref} onClick={() => setMenuOpen(false)}>
              Home
            </Link>
            <a href="#about" onClick={() => setMenuOpen(false)}>
              About
            </a>
            <a href="#gallery" onClick={() => setMenuOpen(false)}>
              Portfolio
            </a>
            <a href="#packages" onClick={() => setMenuOpen(false)}>
              Packages
            </a>
            <Link href={checkoutHref} onClick={() => setMenuOpen(false)}>
              Book ({cartCount})
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

export function StudioHero({ tenant }: { tenant: DemoTenant }) {
  const [active, setActive] = useState(0);
  const slides = useMemo(() => {
    const cover = tenant.coverUrl;
    if (!cover) return [...STUDIO_HERO_SLIDES];
    return [{ title: tenant.shopTheme.promoTitle || tenant.name, subtitle: tenant.tagline, image: cover }, ...STUDIO_HERO_SLIDES.slice(1)];
  }, [tenant.coverUrl, tenant.name, tenant.shopTheme.promoTitle, tenant.tagline]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActive((index) => (index + 1) % slides.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  const slideNum = String(active + 1).padStart(2, "0");

  return (
    <section className="st-hero" id="hero">
      {slides.map((slide, index) => (
        <div
          key={slide.image}
          className={`st-hero-slide ${index === active ? "active" : ""}`}
          style={{ backgroundImage: `url(${sizedImageUrl(slide.image, 600)})` }}
          aria-hidden={index !== active}
        />
      ))}

      <div className="st-hero-content">
        <div className="st-container-fluid">
          <div className="st-slide-text">
            <span className="st-slide-num">{slideNum}.</span>
            <div className="st-slide-copy">
              <h1>{slides[active]?.title}</h1>
              <p>{slides[active]?.subtitle}</p>
              <a href="#packages" className="st-hero-cta">
                View packages
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="st-hero-indicators" role="tablist" aria-label="Hero slides">
        {slides.map((slide, index) => (
          <button
            key={`indicator-${slide.image}`}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-label={`Slide ${index + 1}`}
            className={`st-hero-indicator ${index === active ? "active" : ""}`}
            style={{ backgroundImage: `url(${sizedImageUrl(slide.image, 600)})` }}
            onClick={() => setActive(index)}
          />
        ))}
      </div>
    </section>
  );
}

export function StudioAbout({ tenant }: { tenant: DemoTenant }) {
  const aboutImage =
    tenant.coverUrl ||
    tenant.products[0]?.image ||
    "https://images.unsplash.com/photo-1554048612-b6a482b22d2d?w=900&q=80";

  return (
    <>
      <section className="st-section" id="about">
        <div className="st-container">
          <div className="st-about-thumb">
            <Image src={aboutImage} alt={`About ${tenant.name}`} width={900} height={560} />
          </div>
          <div className="st-section-rule" />
          <h2 className="st-section-title">What can we create together?</h2>
          <p className="st-section-lead">
            {tenant.tagline} Based in {tenant.location}, {tenant.name} offers portrait sessions, wedding coverage,
            commercial shoots, and print & signage packages — crafted for photographers, creatives, and brands who
            value clean, timeless imagery.
          </p>

          <div className="st-services-row">
            {STUDIO_SERVICES.map((service) => {
              const Icon = SERVICE_ICONS[service.icon];
              return (
                <article key={service.title} className="st-service-card">
                  <div className="st-service-icon">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3>{service.title}</h3>
                  <p>{service.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="st-gallery-teaser" id="gallery">
        <div className="st-container">
          <div className="st-gallery-head">
            <div>
              <h2>Portfolio</h2>
              <p className="mt-2 text-sm text-[var(--st-muted)]">
                A glimpse of recent sessions, weddings, and print work.
              </p>
            </div>
            <a href="#packages" className="st-gallery-link">
              Book a session
            </a>
          </div>
          <div className="st-gallery-grid">
            {STUDIO_GALLERY_IMAGES.map((src, index) => (
              <div key={src} className="st-gallery-item">
                <Image src={src} alt={`Portfolio ${index + 1}`} fill sizes="(max-width: 768px) 50vw, 33vw" />
                <div className="st-gallery-overlay">
                  <Eye className="h-6 w-6" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function StudioPackageCard({ tenantSlug, product }: { tenantSlug: string; product: DemoProduct }) {
  const { addItem, ready } = useCart(tenantSlug);
  const [adding, setAdding] = useState(false);
  const productHref = `/${tenantSlug}/products/${product.slug}`;
  const unit = studioPackageUnit(product);
  const badge = isPrintPackage(product) ? "Print" : "Session";

  async function handleBook() {
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
    <article className="st-package-card">
      <div className="st-package-image">
        <Image src={product.image} alt={product.title} fill sizes="(max-width: 768px) 100vw, 33vw" />
        <span className="st-package-badge">{badge}</span>
      </div>
      <div className="st-package-body">
        <p className="st-package-category">{product.category}</p>
        <h3 className="st-package-title">
          <Link href={productHref}>{product.title}</Link>
        </h3>
        <p className="st-package-desc">{product.shortDescription}</p>
        <p className="st-package-price">
          {product.compareAtPrice && product.compareAtPrice > product.price && (
            <del>{formatStudioPrice(product.compareAtPrice)}</del>
          )}
          {formatStudioPrice(product.price)}
          <span> {unit}</span>
        </p>
        <div className="st-package-actions">
          <button type="button" className="st-btn" onClick={handleBook} disabled={!ready || adding}>
            {adding ? "Adding…" : "Book package"}
          </button>
          <Link href={productHref} className="st-btn st-btn-outline">
            Details
          </Link>
        </div>
      </div>
    </article>
  );
}

export function StudioPackages({ tenant }: { tenant: DemoTenant }) {
  const [tab, setTab] = useState<StudioPackageTabId>("all");

  const filtered = useMemo(() => {
    switch (tab) {
      case "sessions":
        return tenant.products.filter((product) => !isPrintPackage(product));
      case "print":
        return tenant.products.filter((product) => isPrintPackage(product));
      default:
        return tenant.products;
    }
  }, [tab, tenant.products]);

  const display = filtered.length > 0 ? filtered : tenant.products;

  return (
    <section className="st-section st-packages-section" id="packages">
      <div className="st-container">
        <div className="st-packages-head">
          <div>
            <h2 className="st-section-title !mb-2 !text-left">Session & print packages</h2>
            <p className="text-sm text-[var(--st-muted)]">
              Book photo sessions or order print & signage packages — add to cart and checkout when ready.
            </p>
          </div>
          <div className="st-tabs" role="tablist">
            {STUDIO_PACKAGE_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={`st-tab ${tab === item.id ? "active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {display.length === 0 ? (
          <p className="text-center text-[var(--st-muted)]">No packages listed yet — check back soon.</p>
        ) : (
          <div className="st-package-grid">
            {display.map((product) => (
              <StudioPackageCard key={product.id} tenantSlug={tenant.slug} product={product} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function StudioFooter({ tenant }: { tenant: DemoTenant }) {
  const homeHref = `/${tenant.slug}`;
  const checkoutHref = `/${tenant.slug}/checkout`;
  const phone = studioPhone(tenant);
  const year = new Date().getFullYear();

  return (
    <footer className="st-footer" id="footer">
      <div className="st-container">
        <div className="st-footer-grid">
          <div>
            <h5>{tenant.name}</h5>
            <p>{tenant.tagline}</p>
            <p className="mt-3">{tenant.location}</p>
            {phone && <p className="mt-2">{phone}</p>}
          </div>
          <div>
            <h5>Studio</h5>
            <ul>
              <li>
                <Link href={homeHref}>Home</Link>
              </li>
              <li>
                <a href="#about">About</a>
              </li>
              <li>
                <a href="#gallery">Portfolio</a>
              </li>
              <li>
                <a href="#packages">Packages</a>
              </li>
            </ul>
          </div>
          <div>
            <h5>Services</h5>
            <ul>
              <li>
                <a href="#packages">Portrait Sessions</a>
              </li>
              <li>
                <a href="#packages">Wedding Coverage</a>
              </li>
              <li>
                <a href="#packages">Commercial Shoots</a>
              </li>
              <li>
                <a href="#packages">Print & Signage</a>
              </li>
            </ul>
          </div>
          <div>
            <h5>Book</h5>
            <ul>
              <li>
                <a href="#packages">Browse Packages</a>
              </li>
              <li>
                <Link href={checkoutHref}>Complete Booking</Link>
              </li>
              <li>
                <a href="#footer">Contact</a>
              </li>
            </ul>
          </div>
        </div>

        <div className="st-footer-bottom">
          <p>© {tenant.name} {year}. All rights reserved.</p>
          <p>Powered by Guma One</p>
        </div>
      </div>
    </footer>
  );
}
