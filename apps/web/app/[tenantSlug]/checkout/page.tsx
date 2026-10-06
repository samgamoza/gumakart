import { notFound } from "next/navigation";
import { CheckoutForm } from "@/components/checkout-form";
import { getStorefrontTenant } from "@/lib/get-storefront-tenant";
import { solidCtaColor } from "@/lib/color-contrast";

interface PageProps {
  params: Promise<{ tenantSlug: string }>;
}

export default async function CheckoutPage({ params }: PageProps) {
  const { tenantSlug } = await params;
  const tenant = await getStorefrontTenant(tenantSlug);
  if (!tenant) notFound();

  // Phase 34: checkout wears the shop's own colour (contrast-safe), like the product page.
  const accent = solidCtaColor(tenant.shopTheme?.primaryColor ?? tenant.theme.primaryColor, "#7c3aed");
  return <CheckoutForm tenantSlug={tenantSlug} storeSettings={tenant.storeSettings} accent={accent} />;
}
