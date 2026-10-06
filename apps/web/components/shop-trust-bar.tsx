import Link from "next/link";
import { Star } from "lucide-react";
import type { PublicReview } from "@gumakart/db";

/**
 * Phase 23: a slim bar above any shop theme — the shop's rating from verified buyers and the newest
 * buyer photos — linking to the shop's reviews page. Hidden until the first published review.
 */
export function ShopTrustBar({
  slug,
  rating,
  photoReviews,
}: {
  slug: string;
  rating: { average: number; count: number } | null;
  photoReviews: PublicReview[];
}) {
  if (!rating) return null;
  const thumbs = photoReviews.flatMap((r) => r.photos.slice(0, 1)).slice(0, 6);
  return (
    <Link
      href={`/${slug}/reviews`}
      data-testid="shop-trust-bar"
      className="flex items-center justify-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950 hover:bg-amber-100"
    >
      <span className="inline-flex items-center gap-1 font-semibold">
        <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
        {rating.average.toFixed(1)}
      </span>
      <span>
        from {rating.count} verified buyer review{rating.count === 1 ? "" : "s"}
      </span>
      {thumbs.length > 0 && (
        <span className="hidden items-center -space-x-2 sm:inline-flex" aria-hidden>
          {thumbs.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p} src={p} alt="" loading="lazy" className="h-7 w-7 rounded-full border-2 border-amber-50 object-cover" />
          ))}
        </span>
      )}
      <span className="font-medium underline-offset-2 hover:underline">See reviews →</span>
    </Link>
  );
}
