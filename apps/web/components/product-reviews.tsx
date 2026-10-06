import { Star } from "lucide-react";
import type { PublicReview } from "@gumakart/db";
import { RatingStars } from "@/components/rating-stars";

/**
 * Phase 23: verified reviews under a product. Every review here came from a delivered order at this
 * shop ("Verified buyer" is true by construction). Shows nothing until the first review.
 */
export function ProductReviews({
  reviews,
  rating,
  shopName,
}: {
  reviews: PublicReview[];
  rating?: { average: number; count: number } | null;
  shopName: string;
}) {
  if (!reviews.length) return null;
  return (
    <section id="reviews" className="mx-auto max-w-5xl px-4 py-10" data-testid="product-reviews">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl font-bold">Reviews</h2>
        <RatingStars rating={rating} size="md" className="text-neutral-600" />
      </div>
      <p className="mt-1 text-xs text-neutral-500">Only buyers with a delivered order can leave a review.</p>
      <ul className="mt-6 space-y-4">
        {reviews.map((r) => (
          <li key={r.id} className="rounded-2xl border border-neutral-200 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex" aria-label={`${r.rating} stars`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={`h-4 w-4 ${n <= r.rating ? "fill-amber-400 text-amber-400" : "text-neutral-300"}`} />
                ))}
              </span>
              <span className="text-sm font-medium">{r.buyerName}</span>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Verified buyer</span>
              <span className="text-xs text-neutral-400">
                {new Date(r.createdAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
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
                <span className="font-semibold">{shopName}:</span> {r.sellerReply}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
