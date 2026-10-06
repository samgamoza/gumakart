import Link from "next/link";
import { notFound } from "next/navigation";
import { Star } from "lucide-react";
import { getTenantIdBySlug, listShopReviews } from "@gumakart/db";
import { getStorefrontTenant } from "@/lib/get-storefront-tenant";
import { ShopShell } from "@/components/storefront/shop-shell";
import { RatingStars } from "@/components/rating-stars";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ tenantSlug: string }>;
}

/** Phase 23: every published review for the shop. All from delivered orders. */
export default async function ShopReviewsPage({ params }: PageProps) {
  const { tenantSlug } = await params;
  const tenant = await getStorefrontTenant(tenantSlug);
  if (!tenant) notFound();
  const tenantId = await getTenantIdBySlug(tenantSlug).catch(() => null);
  const reviews = tenantId ? await listShopReviews(tenantId, 100).catch(() => []) : [];
  const bySlug = new Map(tenant.products.map((p) => [p.title, p.slug]));

  return (
    <ShopShell tenant={tenant}>
      <section className="mx-auto max-w-3xl px-4 py-10" data-testid="shop-reviews">
        <h1 className="font-display text-3xl font-bold">Reviews</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-neutral-600">
          <RatingStars rating={tenant.rating} size="md" />
          <span className="text-sm">Only buyers with a delivered order from {tenant.name} can review.</span>
        </div>
        {reviews.length === 0 ? (
          <p className="mt-8 text-neutral-500">No reviews yet.</p>
        ) : (
          <ul className="mt-8 space-y-4">
            {reviews.map((r) => {
              const slug = r.productTitle ? bySlug.get(r.productTitle) : undefined;
              return (
                <li key={r.id} className="rounded-2xl border border-neutral-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex" aria-label={`${r.rating} stars`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={`h-4 w-4 ${n <= r.rating ? "fill-amber-400 text-amber-400" : "text-neutral-300"}`} />
                      ))}
                    </span>
                    <span className="text-sm font-medium">{r.buyerName}</span>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Verified buyer</span>
                  </div>
                  {r.productTitle ? (
                    <p className="mt-1 text-xs text-neutral-500">
                      {slug ? (
                        <Link href={`/${tenantSlug}/products/${slug}`} className="hover:underline">
                          {r.productTitle}
                        </Link>
                      ) : (
                        r.productTitle
                      )}{" "}
                      · {new Date(r.createdAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  ) : null}
                  {r.body ? <p className="mt-2 whitespace-pre-line text-sm text-neutral-700">{r.body}</p> : null}
                  {r.photos.length ? (
                    <div className="mt-3 flex gap-2">
                      {r.photos.map((p) => (
                        <a key={p} href={p} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p} alt="Buyer photo" loading="lazy" className="h-20 w-20 rounded-lg object-cover" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {r.sellerReply ? (
                    <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
                      <span className="font-semibold">{tenant.name}:</span> {r.sellerReply}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </ShopShell>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { tenantSlug } = await params;
  const tenant = await getStorefrontTenant(tenantSlug);
  return tenant ? { title: `Reviews — ${tenant.name}` } : {};
}
