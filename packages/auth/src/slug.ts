const RESERVED_SLUGS = new Set([
  // Top-level storefront routes (apps/web/app/*) — a shop with one of these
  // slugs would be shadowed by, or shadow, a real page.
  "about",
  "frontend1",
  "guma-one-ai",
  "kart",
  "preview",
  "uploads",
  "stop",
  "c", // checkout links: /c/<code> (also below the 3-char minimum)
  "icon",
  "robots",
  "sitemap",
  "favicon",
  "admin",
  "api",
  "app",
  "auth",
  "blog",
  "careers",
  "checkout",
  "contact",
  "demo",
  "faq",
  "help",
  "login",
  "model",
  "model-store",
  "showcase",
  "onboarding",
  "orders",
  "pricing",
  "privacy",
  "products",
  "refunds",
  "signup",
  "status",
  "terms",
  "verify-email",
  "www",
]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function validateSlug(slug: string): { ok: true } | { ok: false; reason: string } {
  if (slug.length < 3) {
    return { ok: false, reason: "Shop URL must be at least 3 characters." };
  }
  if (slug.length > 32) {
    return { ok: false, reason: "Shop URL must be 32 characters or less." };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      reason: "Use lowercase letters, numbers, and hyphens only (e.g. halo-queen).",
    };
  }
  // "*-demo" is the namespace for built-in demo shops.
  if (RESERVED_SLUGS.has(slug) || slug.endsWith("-demo")) {
    return { ok: false, reason: "This shop URL is reserved. Please choose another." };
  }
  return { ok: true };
}

export function slugFromShopName(name: string): string {
  return normalizeSlug(name);
}
