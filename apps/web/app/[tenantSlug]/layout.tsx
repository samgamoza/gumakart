import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { getStorefrontTenant } from "@/lib/get-storefront-tenant";
import { StorefrontTracking } from "@/components/storefront/storefront-tracking";
import { StorefrontJsonLd } from "@/components/storefront/storefront-json-ld";
import { VariantProductRegistry } from "@/components/storefront/variant-product-registry";
import { AttributionCapture } from "@/components/storefront/attribution-capture";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}

export default async function TenantStorefrontLayout({ children, params }: LayoutProps) {
  const { tenantSlug } = await params;
  const tenant = await getStorefrontTenant(tenantSlug);

  return (
    <div className={`${spaceGrotesk.variable} ${inter.variable}`}>
      {tenant && <StorefrontTracking tracking={tenant.storeSettings.tracking} />}
      {tenant && <AttributionCapture tenantSlug={tenant.slug} />}
      {tenant && (
        <VariantProductRegistry
          tenantSlug={tenant.slug}
          products={tenant.products.filter((p) => p.variants?.length).map((p) => ({ id: p.id, slug: p.slug }))}
        />
      )}
      {tenant?.seo?.jsonLd &&
        Array.isArray(tenant.seo.jsonLd) &&
        tenant.seo.jsonLd.length > 0 && (
        <StorefrontJsonLd blocks={tenant.seo.jsonLd} />
      )}
      {children}
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}): Promise<Metadata> {
  const { tenantSlug } = await params;
  const tenant = await getStorefrontTenant(tenantSlug);
  if (!tenant) return {};

  const seo = tenant.seo;
  const title = seo?.siteTitle?.trim() || `${tenant.name} — Shop`;
  const description = seo?.metaDescription?.trim() || tenant.tagline;
  const canonical = seo?.canonicalUrl?.trim() || undefined;
  const ogTitle = seo?.openGraph?.title?.trim() || title;
  const ogDescription = seo?.openGraph?.description?.trim() || description;
  const ogImage = seo?.openGraph?.imageUrl?.trim();
  const twTitle = seo?.twitter?.title?.trim() || ogTitle;
  const twDescription = seo?.twitter?.description?.trim() || ogDescription;
  const twImage = seo?.twitter?.imageUrl?.trim() || ogImage;
  const index = seo?.robots?.index !== false;
  const follow = seo?.robots?.follow !== false;

  return {
    title,
    description,
    keywords: seo?.keywords?.length ? seo.keywords : undefined,
    alternates: canonical ? { canonical } : undefined,
    robots: {
      index,
      follow,
    },
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      type: (seo?.openGraph?.type as "website") || "website",
      url: canonical,
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: seo?.twitter?.card === "summary" ? "summary" : "summary_large_image",
      title: twTitle,
      description: twDescription,
      images: twImage ? [twImage] : undefined,
    },
  };
}
