import Link from "next/link";
import { Star } from "lucide-react";
import { listReportedReviews } from "@gumakart/db";
import { requireSuperAdmin } from "@/lib/session";
import { PlatformShell } from "@/components/platform-shell";
import { ReviewReportActions } from "@/components/review-report-actions";
import { EmptyState, Panel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

const TABS = [
  { id: "open", label: "Open" },
  { id: "kept", label: "Kept" },
  { id: "removed", label: "Removed" },
] as const;

const storefront = () => (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3010").replace(/\/$/, "");

/**
 * Phase 23: product reviews a seller reported (abuse, spam, personal info, not a real experience).
 * Keep = the report closes and nothing changes. Remove = hidden for good; the seller can't show it again.
 */
export default async function ReviewReportsPage({ searchParams }: PageProps) {
  const session = await requireSuperAdmin();
  const { status: raw } = await searchParams;
  const status = TABS.some((t) => t.id === raw) ? (raw as "open" | "kept" | "removed") : "open";
  const rows = await listReportedReviews(status);
  const photo = (p: string) => (p.startsWith("/") ? `${storefront()}${p}` : p);

  return (
    <PlatformShell
      title="Review reports"
      subtitle="Reviews sellers asked Guma to check. Never edit a buyer's words — keep or remove."
      user={{ displayName: session.displayName, email: session.email }}
    >
      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/moderation/reviews?status=${t.id}`}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${status === t.id ? "bg-violet-600 text-white" : "bg-muted text-muted-foreground"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Star className="h-5 w-5" />} title="Nothing here" hint="No reported reviews in this list." />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Panel key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
                <div>
                  <p className="font-semibold">
                    {r.tenantName} · {r.productTitle ?? "Product removed"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {"★".repeat(r.rating)}
                    {"☆".repeat(5 - r.rating)} · {r.buyerName} · order {r.orderNumber} · reviewed {formatDateTime(r.createdAt)}
                  </p>
                </div>
                <p className="max-w-sm rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
                  Seller's report{r.reportedAt ? ` (${formatDateTime(r.reportedAt)})` : ""}: {r.reportReason}
                </p>
              </div>
              {r.body ? <p className="mt-3 whitespace-pre-wrap text-sm">{r.body}</p> : <p className="mt-3 text-sm italic text-muted-foreground">Stars only.</p>}
              {r.photos.length > 0 && (
                <div className="mt-3 flex gap-2">
                  {r.photos.map((p) => (
                    <a key={p} href={photo(p)} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo(p)} alt="" className="h-20 w-20 rounded-lg object-cover" />
                    </a>
                  ))}
                </div>
              )}
              {status === "open" && (
                <div className="mt-4 border-t border-border pt-3">
                  <ReviewReportActions reviewId={r.id} label={`${r.tenantName} — ${r.productTitle ?? "review"}`} />
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
    </PlatformShell>
  );
}
