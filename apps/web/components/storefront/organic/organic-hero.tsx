import Link from "next/link";
import { Leaf, RefreshCw, Truck } from "lucide-react";
import type { DemoTenant } from "@/lib/demo-data";
import { sizedImageUrl } from "@/lib/image-sizes";

export function OrganicHero({ tenant }: { tenant: DemoTenant }) {
  const heroImage =
    tenant.coverUrl ?? "https://images.unsplash.com/photo-1542838132-92c53300491e?w=1600&q=80";
  const shopHref = `/${tenant.slug}#products`;

  return (
    <section className="organic-hero" style={{ backgroundImage: `linear-gradient(rgba(255,255,255,0.88), rgba(255,255,255,0.92)), url(${sizedImageUrl(heroImage, 600)})` }}>
      <div className="organic-container-lg">
        <div className="organic-hero-copy">
          <h1>
            <span className="highlight">{tenant.name.split(" ")[0]}</span> farm-fresh produce at your{" "}
            <span className="highlight">doorstep</span>
          </h1>
          <p>{tenant.tagline}</p>
          <div className="flex flex-wrap gap-3">
            <Link href={shopHref} className="organic-btn organic-btn-primary">
              Start Shopping
            </Link>
            <a href="#categories" className="organic-btn organic-btn-dark">
              Browse Categories
            </a>
          </div>

          <div className="organic-hero-stats">
            <div>
              <p className="organic-stat-value">200+</p>
              <p className="organic-stat-label">Farm Products</p>
            </div>
            <div>
              <p className="organic-stat-value">15k+</p>
              <p className="organic-stat-label">Happy Customers</p>
            </div>
            <div>
              <p className="organic-stat-value">5+</p>
              <p className="organic-stat-label">Partner Farms</p>
            </div>
          </div>
        </div>

        <div className="organic-feature-strip">
          <div className="organic-feature-card primary">
            <RefreshCw className="mb-2 h-8 w-8" aria-hidden />
            <h3>Fresh from farm</h3>
            <p>Harvested and packed within 24 hours from our partner farms.</p>
          </div>
          <div className="organic-feature-card accent">
            <Leaf className="mb-2 h-8 w-8" aria-hidden />
            <h3>100% Organic</h3>
            <p>Certified organic produce with no synthetic pesticides or GMOs.</p>
          </div>
          <div className="organic-feature-card danger">
            <Truck className="mb-2 h-8 w-8" aria-hidden />
            <h3>Free delivery</h3>
            <p>{tenant.shopTheme.promoSubtitle}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
