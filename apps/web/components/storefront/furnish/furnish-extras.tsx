"use client";

import { FormEvent, useState } from "react";
import type { DemoTenant } from "@/lib/demo-data";
import { sizedImageUrl } from "@/lib/image-sizes";

const QUOTE_BG =
  "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1400&q=80";

export function FurnishTestimonial() {
  return (
    <section
      className="furnish-quote"
      style={{ backgroundImage: `url(${sizedImageUrl(QUOTE_BG, 600)})` }}
      aria-label="Customer testimonial"
    >
      <div className="furnish-container">
        <div className="furnish-quote-card">
          <p className="mb-6 italic leading-relaxed text-[var(--furnish-gray-600)]">
            &ldquo;The quality exceeded our expectations — every piece feels thoughtfully crafted.
            Delivery was smooth and the team helped us style our living room perfectly.&rdquo;
          </p>
          <div>
            <h4 className="text-lg font-semibold text-[var(--furnish-gray-900)]">Maria Santos</h4>
            <small className="text-sm text-[var(--furnish-gray-600)]">Interior Designer, Makati</small>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FurnishNewsletter({ tenant }: { tenant: DemoTenant }) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitted(true);
  }

  return (
    <section className="furnish-newsletter" id="newsletter">
      <div className="furnish-container">
        <h2 className="furnish-section-title">Subscribe to our Newsletter</h2>
        <p className="furnish-section-lead mx-auto">
          Get new arrivals, styling tips, and exclusive offers from {tenant.name}.
        </p>
        {submitted ? (
          <p className="mt-6 text-[var(--furnish-secondary)]">Thanks for subscribing!</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              aria-label="Email address"
            />
            <button type="submit" className="furnish-btn">
              Subscribe
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
