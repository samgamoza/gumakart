import { notFound } from "next/navigation";
import { getStorefrontProduct } from "@/lib/get-storefront-tenant";
import { ShopShell } from "@/components/storefront/shop-shell";
import { ShopifyProductStage } from "@/components/storefront/shopify-product-stage";
import { DealsBanner } from "@/components/storefront/deals-banner";
import { getPublishedCheckoutForSlug } from "@gumakart/db";

interface PageProps {
  params: Promise<{ tenantSlug: string; productSlug: string }>;
}

export default async function ProductPage({ params }: PageProps) {
  const { tenantSlug, productSlug } = await params;
  const result = await getStorefrontProduct(tenantSlug, productSlug);
  if (!result) notFound();

  const { tenant, product } = result;
  const checkout = await getPublishedCheckoutForSlug(tenantSlug).catch(() => null);

  return (
    <ShopShell tenant={tenant}>
      <DealsBanner checkout={checkout} productId={product.id} />
      <ShopifyProductStage tenant={tenant} product={product} />
    </ShopShell>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { tenantSlug, productSlug } = await params;
  const result = await getStorefrontProduct(tenantSlug, productSlug);
  if (!result) return {};

  return {
    title: `${result.product.title} — ${result.tenant.name}`,
    description: result.product.shortDescription,
  };
}
