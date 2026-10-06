import { Star } from "lucide-react";

/**
 * Phase 23: average stars + count from verified buyer reviews. Renders nothing without reviews —
 * we never show placeholder or invented ratings.
 */
export function RatingStars({
  rating,
  size = "sm",
  className = "",
}: {
  rating?: { average: number; count: number } | null;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!rating || rating.count < 1) return null;
  const px = size === "md" ? "h-4 w-4" : "h-3 w-3";
  const full = Math.round(rating.average);
  return (
    <span
      className={`inline-flex items-center gap-1 ${size === "md" ? "text-sm" : "text-xs"} ${className}`}
      aria-label={`Rated ${rating.average.toFixed(1)} out of 5 by ${rating.count} verified buyer${rating.count === 1 ? "" : "s"}`}
      data-testid="rating-stars"
    >
      <span className="inline-flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} className={`${px} ${n <= full ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />
        ))}
      </span>
      <span className="font-medium">{rating.average.toFixed(1)}</span>
      <span className="opacity-70">({rating.count})</span>
    </span>
  );
}
