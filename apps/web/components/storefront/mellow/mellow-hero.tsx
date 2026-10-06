"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { DemoTenant } from "@/lib/demo-data";
import { sizedImageUrl } from "@/lib/image-sizes";

export function MellowHero({ tenant }: { tenant: DemoTenant }) {
  const heroImage =
    tenant.coverUrl ?? "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1600&q=80";
  const roomsHref = `/${tenant.slug}#rooms`;

  return (
    <section className="mellow-hero">
      <div className="mellow-container-fluid">
        <div className="mellow-hero-panel" style={{ backgroundImage: `url(${sizedImageUrl(heroImage, 600)})` }}>
          <div className="mellow-hero-grid">
            <div className="mellow-hero-copy">
              <h1>{tenant.shopTheme.promoTitle}</h1>
              <Link href={roomsHref} className="mellow-btn">
                Explore rooms
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <form
              className="mellow-booking-card"
              onSubmit={(event) => {
                event.preventDefault();
                window.location.href = roomsHref;
              }}
            >
              <h3>Check availability</h3>
              <div className="mellow-field">
                <label htmlFor="mellow-checkin">Check-In</label>
                <input id="mellow-checkin" type="date" />
              </div>
              <div className="mellow-field">
                <label htmlFor="mellow-checkout">Check-Out</label>
                <input id="mellow-checkout" type="date" />
              </div>
              <div className="mellow-field">
                <label htmlFor="mellow-rooms">Rooms</label>
                <input id="mellow-rooms" type="number" min={1} defaultValue={1} />
              </div>
              <div className="mellow-field">
                <label htmlFor="mellow-guests">Guests</label>
                <input id="mellow-guests" type="number" min={1} defaultValue={2} />
              </div>
              <button type="submit" className="mellow-btn w-full justify-center">
                Check availability
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
