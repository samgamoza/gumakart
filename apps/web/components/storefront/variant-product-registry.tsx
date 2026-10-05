"use client";

import { registerVariantProducts } from "@/lib/cart";

/**
 * Tells the cart which products need a size/colour pick, so template quick-add
 * buttons open the product page instead of adding a line without a variant.
 * Registers during render (module state, idempotent) so it's set before any click.
 */
export function VariantProductRegistry({
  tenantSlug,
  products,
}: {
  tenantSlug: string;
  products: Array<{ id: string; slug: string }>;
}) {
  if (typeof window !== "undefined") registerVariantProducts(tenantSlug, products);
  return null;
}
