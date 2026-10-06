import { notFound } from "next/navigation";
import { getStorefrontProduct } from "@/lib/get-storefront-tenant";
import { ShopShell } from "@/components/storefront/shop-shell";
import { ShopifyProductStage } from "@/components/storefront/shopify-product-stage";
import { DealsBanner } from "@/components/storefront/deals-banner";
import { getPublishedCheckoutForSlug, getTenantIdBySlug, listProductReviews } from "@gumakart/db";
import { ProductReviews } from "@/components/product-reviews";

interface PageProps {
  params: Promise<{ tenantSlug: string; productSlug: string }>;
}

export default async function ProductPage({ params }: PageProps) {
  const { tenantSlug, productSlug } = await params;
  const result = await getStorefrontProduct(tenantSlug, productSlug);
  if (!result) notFound();

  const { tenant, product } = result;
  const checkout = await getPublishedCheckoutForSlug(tenantSlug).catch(() => null);
  // Phase 23: verified reviews (none for demo shops or products without reviews).
  const reviews = product.rating
    ? await getTenantIdBySlug(tenantSlug)
        .then((id) => (id ? listProductReviews(id, product.id, 20) : []))
        .catch(() => [])
    : [];

  return (
    <ShopShell tenant={tenant}>
      <DealsBanner checkout={checkout} productId={product.id} />
      <ShopifyProductStage tenant={tenant} product={product} />
      <ProductReviews reviews={reviews} rating={product.rating} shopName={tenant.name} />
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
