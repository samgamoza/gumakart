"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { shrinkImage } from "@gumakart/ui/shrink-image";

type Item = {
  orderItemId: string;
  title: string;
  variant: string | null;
  review: { rating: number; body: string | null; photos: string[]; status: string; sellerReply: string | null } | null;
};

/**
 * Phase 23: "Kumusta ang order mo?" — the buyer rates each item on a delivered order. Verified by
 * the order link; one review per item; up to 3 photos, shrunk on the phone before upload.
 */
export function OrderReviewCard({
  tenantSlug,
  orderNumber,
  accessToken,
  shopName,
  items: initial,
}: {
  tenantSlug: string;
  orderNumber: string;
  accessToken: string;
  shopName: string;
  items: Item[];
}) {
  const [items, setItems] = useState(initial);
  const pending = items.filter((i) => !i.review).length;
  return (
    <div data-testid="order-review-card" className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
      <h2 className="font-semibold">Kumusta ang order mo?</h2>
      <p className="mt-1 text-sm text-slate-600">
        {pending > 0
          ? `Rate your items — it helps ${shopName} and other buyers. Only buyers who ordered can review.`
          : "Salamat sa review mo!"}
      </p>
      <ul className="mt-4 space-y-4">
        {items.map((item) => (
          <li key={item.orderItemId} className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-sm font-medium">
              {item.title}
              {item.variant ? <span className="text-slate-500"> · {item.variant}</span> : null}
            </p>
            {item.review ? (
              <SubmittedReview review={item.review} shopName={shopName} />
            ) : (
              <ReviewForm
                item={item}
                ctx={{ tenantSlug, orderNumber, accessToken }}
                onDone={(review) => setItems((all) => all.map((i) => (i.orderItemId === item.orderItemId ? { ...i, review } : i)))}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stars({ value, onChange, size = 28 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <div className="flex gap-1" role={onChange ? "radiogroup" : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= value;
        const icon = <Star style={{ width: size, height: size }} className={on ? "fill-amber-400 text-amber-400" : "text-slate-300"} />;
        return onChange ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => onChange(n)} className="p-0.5">
            {icon}
          </button>
        ) : (
          <span key={n}>{icon}</span>
        );
      })}
    </div>
  );
}

function SubmittedReview({ review, shopName }: { review: NonNullable<Item["review"]>; shopName: string }) {
  return (
    <div className="mt-2 space-y-2">
      <Stars value={review.rating} size={18} />
      {review.body ? <p className="text-sm text-slate-700">{review.body}</p> : null}
      {review.photos.length ? (
        <div className="flex gap-2">
          {review.photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p} src={p} alt="" className="h-16 w-16 rounded-lg object-cover" />
          ))}
        </div>
      ) : null}
      {review.status !== "published" ? <p className="text-xs text-slate-500">The shop isn't showing this review publicly.</p> : null}
      {review.sellerReply ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold">{shopName}:</span> {review.sellerReply}
        </p>
      ) : null}
    </div>
  );
}

function ReviewForm({
  item,
  ctx,
  onDone,
}: {
  item: Item;
  ctx: { tenantSlug: string; orderNumber: string; accessToken: string };
  onDone: (review: NonNullable<Item["review"]>) => void;
}) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState<"photo" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addPhoto(file: File) {
    setBusy("photo");
    setError(null);
    try {
      const small = await shrinkImage(file, { maxSide: 1400, quality: 0.8 });
      const form = new FormData();
      form.set("tenantSlug", ctx.tenantSlug);
      form.set("orderNumber", ctx.orderNumber);
      form.set("accessToken", ctx.accessToken);
      form.set("file", small);
      const res = await fetch("/api/reviews/photo", { method: "POST", body: form });
      const data = await res.json();
      if (!data.ok) setError(data.error ?? "Could not upload the photo.");
      else setPhotos((p) => [...p, data.url].slice(0, 3));
    } catch {
      setError("Could not upload the photo.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!rating) {
      setError("Tap the stars first.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ctx, orderItemId: item.orderItemId, rating, body: body.trim() || undefined, photos }),
      });
      const data = await res.json();
      if (!data.ok) setError(data.error ?? "Could not save your review.");
      else onDone({ rating, body: body.trim() || null, photos, status: "published", sellerReply: null });
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 space-y-3" data-testid="review-form">
      <Stars value={rating} onChange={setRating} />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 1000))}
        rows={3}
        placeholder="Ano'ng nagustuhan mo? (optional)"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((p) => (
          <span key={p} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p} alt="" className="h-16 w-16 rounded-lg object-cover" />
            <button
              type="button"
              aria-label="Remove photo"
              onClick={() => setPhotos((all) => all.filter((x) => x !== p))}
              className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-slate-800 text-[11px] leading-5 text-white"
            >
              ×
            </button>
          </span>
        ))}
        {photos.length < 3 && (
          <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 text-center text-[11px] text-slate-500">
            {busy === "photo" ? "…" : "+ Photo"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void addPhoto(f);
              }}
            />
          </label>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy !== null}
        className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy === "save" ? "Saving…" : "Submit review"}
      </button>
    </div>
  );
}
