import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getStorefrontTenant,
  getStorefrontTenantPreview,
  getUnavailableStorefrontTenant,
} from "@/lib/get-storefront-tenant";
import { verifyStorefrontPreviewToken } from "@gumakart/services";
import { adminUrl } from "@/lib/utils";
import { TenantStorefrontHome } from "@/components/storefront/tenant-storefront-home";
import { ShopTrustBar } from "@/components/shop-trust-bar";
import { getShopReviewHighlights, getTenantIdBySlug } from "@gumakart/db";

/** Seller catalog changes must show up immediately after publish/add. */
export const dynamic = "force-dynamic";

const UTM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  shop_assistant: "our shop assistant",
};

interface PageProps {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function StorefrontPage({ params, searchParams }: PageProps) {
  const { tenantSlug } = await params;
  const query = await searchParams;
  // Drafts are private: ?preview=1 only works with a signed link from admin
  // (/api/storefront-preview). Without it the visitor sees the live shop.
  const isPreview =
    query.preview === "1" && verifyStorefrontPreviewToken(tenantSlug, query.pt ?? null);

  const tenant = isPreview
    ? await getStorefrontTenantPreview(tenantSlug)
    : await getStorefrontTenant(tenantSlug);

  if (!tenant) {
    const unavailable = await getUnavailableStorefrontTenant(tenantSlug);
    if (unavailable?.kind === "pending") {
      return (
        <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-6 text-center hero-glow">
          <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-40 [mask-image:linear-gradient(to_bottom,white,transparent)]" />
          <div className="relative flex flex-col items-center">
            <span className="flex h-20 w-20 animate-float items-center justify-center rounded-3xl border border-border/60 bg-card text-4xl shadow-xl">
              🛍️
            </span>
            <span className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
              </span>
              Coming soon
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight">{unavailable.name}</h1>
            <p className="mt-2 max-w-sm text-muted-foreground">{unavailable.message}</p>
            <Link
              href={`${adminUrl}/launch`}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition hover:bg-emerald-700"
            >
              Continue GUMA Launch
            </Link>
          </div>
        </div>
      );
    }

    if (unavailable?.kind === "suspended") {
      return (
        <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-6 text-center">
          <div className="relative flex max-w-md flex-col items-center">
            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
              Shop unavailable
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight">{unavailable.name}</h1>
            <p className="mt-2 text-muted-foreground">{unavailable.message}</p>
          </div>
        </div>
      );
    }

    notFound();
  }

  const utmSource = query.utm_source ?? "";
  // Phase 23: shop rating bar (only once there are published reviews; never for demo shops).
  const highlights = tenant.rating
    ? await getTenantIdBySlug(tenantSlug)
        .then((id) => (id ? getShopReviewHighlights(id, 6) : null))
        .catch(() => null)
    : null;

  return (
    <>
      {isPreview && (
        <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-amber-950">
          <span>Draft preview — not live to buyers until you publish &amp; activate</span>
          <span className="flex items-center gap-2">
            <a
              href={adminUrl}
              className="inline-flex items-center gap-1 rounded-full border border-amber-950/30 px-2.5 py-0.5 text-xs transition hover:bg-amber-950/10"
            >
              ← Back to dashboard
            </a>
            <a
              href={`${adminUrl}/launch`}
              className="inline-flex items-center gap-1 rounded-full bg-amber-950 px-2.5 py-0.5 text-xs text-amber-50 transition hover:bg-amber-900"
            >
              Edit shop
            </a>
          </span>
        </div>
      )}
      {highlights?.rating ? <ShopTrustBar slug={tenant.slug} rating={highlights.rating} photoReviews={highlights.photoReviews} /> : null}
      <TenantStorefrontHome
        tenant={tenant}
        activeCategorySlug={query.category}
        utmLabel={UTM_LABELS[utmSource] ?? (utmSource || undefined)}
      />
    </>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { tenantSlug } = await params;
  const tenant = await getStorefrontTenant(tenantSlug);
  if (tenant) {
    return {
      title: `${tenant.name} — Shop`,
      description: tenant.tagline,
    };
  }

  const unavailable = await getUnavailableStorefrontTenant(tenantSlug);
  if (unavailable?.kind === "pending") {
    return {
      title: `${unavailable.name} — Coming soon`,
      description: `${unavailable.name} is setting up their Guma One shop.`,
    };
  }
  if (unavailable?.kind === "suspended") {
    return {
      title: `${unavailable.name} — Unavailable`,
      description: unavailable.message,
    };
  }

  return {};
}
