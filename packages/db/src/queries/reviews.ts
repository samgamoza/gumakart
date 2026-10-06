/**
 * Phase 23: verified product reviews.
 *  - Only from the shop's own orders: delivered, or completed, and not cancelled; within 120 days.
 *  - One review per order item. The buyer's words are never edited; the seller can reply or hide
 *    (with a reason), and can report one to Guma ops, who may remove it.
 *  - Storefront numbers come only from published reviews — nothing invented, no minimum padding.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import { orderItems, orders, productReviews, products, tenants } from "../schema";

export const REVIEW_WINDOW_DAYS = 120;
export const REVIEW_MAX_PHOTOS = 3;

export class ReviewError extends Error {
  constructor(message: string, readonly code: "NOT_FOUND" | "NOT_ELIGIBLE" | "DUPLICATE" | "INVALID" | "LOCKED") {
    super(message);
  }
}

/** "Ana Maria Reyes" → "Ana R."; never the phone or full surname. Pure, exported for tests. */
export function reviewDisplayName(name: string | null | undefined): string {
  const parts = (name ?? "").replace(/[^\p{L}\p{N} .'-]/gu, "").trim().split(/\s+/).filter(Boolean);
  // POS placeholders ("Walk-in", "Guest") aren't names.
  if (!parts.length || /^(walk-?in|guest|customer|buyer)$/i.test(parts.join(" "))) return "Buyer";
  const first = parts[0]!.slice(0, 20);
  const last = parts.length > 1 ? `${parts[parts.length - 1]![0]!.toUpperCase()}.` : "";
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}${last ? ` ${last}` : ""}`;
}

/** Pure: can this order be reviewed? Exported for tests. */
export function reviewEligibility(o: {
  orderState: string | null;
  fulfillmentState: string | null;
  createdAt: Date;
  now?: Date;
}): { ok: true } | { ok: false; reason: string } {
  if (o.orderState === "cancelled") return { ok: false, reason: "This order was cancelled." };
  if (o.fulfillmentState !== "delivered" && o.orderState !== "completed") {
    return { ok: false, reason: "You can rate your items once the order is delivered." };
  }
  const age = ((o.now ?? new Date()).getTime() - o.createdAt.getTime()) / 86_400_000;
  if (age > REVIEW_WINDOW_DAYS) return { ok: false, reason: "Reviews close 120 days after the order." };
  return { ok: true };
}

export interface ReviewableItem {
  orderItemId: string;
  title: string;
  variant: string | null;
  productId: string;
  review: { rating: number; body: string | null; photos: string[]; status: string; sellerReply: string | null } | null;
}

/** The order's items with any review already left. `eligible` false explains why the form is closed. */
export async function getReviewableItems(orderId: string): Promise<{ eligible: boolean; reason: string | null; items: ReviewableItem[] }> {
  const db = getDb();
  const [o] = await db
    .select({ orderState: orders.orderState, fulfillmentState: orders.fulfillmentState, createdAt: orders.createdAt })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!o) return { eligible: false, reason: "Order not found.", items: [] };
  const check = reviewEligibility({ orderState: o.orderState, fulfillmentState: o.fulfillmentState, createdAt: o.createdAt });
  const rows = await db
    .select({
      orderItemId: orderItems.id,
      title: orderItems.titleSnapshot,
      variant: orderItems.variantSnapshot,
      productId: orderItems.productId,
      rating: productReviews.rating,
      body: productReviews.body,
      photos: productReviews.photosJson,
      status: productReviews.status,
      sellerReply: productReviews.sellerReply,
    })
    .from(orderItems)
    .leftJoin(productReviews, eq(productReviews.orderItemId, orderItems.id))
    .where(eq(orderItems.orderId, orderId));
  const items = rows
    .filter((r) => r.productId)
    .map((r) => ({
      orderItemId: r.orderItemId,
      title: r.title,
      variant: typeof r.variant === "string" && r.variant && r.variant !== "Default" ? r.variant : null,
      productId: r.productId!,
      review: r.rating != null ? { rating: r.rating, body: r.body, photos: r.photos ?? [], status: r.status!, sellerReply: r.sellerReply } : null,
    }));
  return { eligible: check.ok, reason: check.ok ? null : check.reason, items };
}

/** A buyer's review of one item on their order (the caller has already checked the order link). */
export async function submitReview(input: {
  orderId: string;
  orderItemId: string;
  rating: number;
  body?: string | null;
  photos?: string[];
}): Promise<{ id: string }> {
  const db = getDb();
  const rating = Math.round(Number(input.rating));
  if (!(rating >= 1 && rating <= 5)) throw new ReviewError("Pick 1 to 5 stars.", "INVALID");
  const body = (input.body ?? "").replace(/\s+\n/g, "\n").trim().slice(0, 1000) || null;
  const photos = (input.photos ?? []).filter((p) => typeof p === "string" && p.length < 500).slice(0, REVIEW_MAX_PHOTOS);

  const [row] = await db
    .select({
      tenantId: orders.tenantId,
      orderState: orders.orderState,
      fulfillmentState: orders.fulfillmentState,
      createdAt: orders.createdAt,
      guestName: orders.guestName,
      productId: orderItems.productId,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.id, input.orderItemId), eq(orderItems.orderId, input.orderId)))
    .limit(1);
  if (!row || !row.productId) throw new ReviewError("That item isn't on this order.", "NOT_FOUND");
  const check = reviewEligibility({ orderState: row.orderState, fulfillmentState: row.fulfillmentState, createdAt: row.createdAt });
  if (!check.ok) throw new ReviewError(check.reason, "NOT_ELIGIBLE");

  const [inserted] = await db
    .insert(productReviews)
    .values({
      tenantId: row.tenantId,
      orderId: input.orderId,
      orderItemId: input.orderItemId,
      productId: row.productId,
      rating,
      body,
      photosJson: photos,
      buyerName: reviewDisplayName(row.guestName),
    })
    .onConflictDoNothing()
    .returning({ id: productReviews.id });
  if (!inserted) throw new ReviewError("You already rated this item. Salamat!", "DUPLICATE");
  return inserted;
}

// ─── Seller side ────────────────────────────────────────────────────────────────────────────────

export type ReviewFilter = "all" | "needs_reply" | "low" | "hidden" | "reported";

export interface SellerReviewRow {
  id: string;
  rating: number;
  body: string | null;
  photos: string[];
  buyerName: string;
  productTitle: string | null;
  orderNumber: string;
  status: "published" | "hidden" | "removed";
  hiddenReason: string | null;
  sellerReply: string | null;
  reportStatus: "open" | "kept" | "removed" | null;
  createdAt: string;
}

export async function listTenantReviews(tenantId: string, filter: ReviewFilter = "all", limit = 100): Promise<SellerReviewRow[]> {
  const db = getDb();
  const where = [eq(productReviews.tenantId, tenantId)];
  if (filter === "needs_reply") where.push(sql`${productReviews.sellerReply} is null and ${productReviews.status} = 'published'`);
  if (filter === "low") where.push(sql`${productReviews.rating} <= 3`);
  if (filter === "hidden") where.push(sql`${productReviews.status} <> 'published'`);
  if (filter === "reported") where.push(sql`${productReviews.reportStatus} is not null`);
  const rows = await db
    .select({ r: productReviews, productTitle: products.title, orderNumber: orders.orderNumber })
    .from(productReviews)
    .innerJoin(orders, eq(orders.id, productReviews.orderId))
    .leftJoin(products, eq(products.id, productReviews.productId))
    .where(and(...where))
    .orderBy(desc(productReviews.createdAt))
    .limit(Math.min(200, Math.max(1, limit)));
  return rows.map(({ r, productTitle, orderNumber }) => ({
    id: r.id,
    rating: r.rating,
    body: r.body,
    photos: r.photosJson ?? [],
    buyerName: r.buyerName,
    productTitle,
    orderNumber,
    status: r.status,
    hiddenReason: r.hiddenReason,
    sellerReply: r.sellerReply,
    reportStatus: r.reportStatus ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function ownReview(tenantId: string, id: string) {
  const [r] = await getDb()
    .select()
    .from(productReviews)
    .where(and(eq(productReviews.id, id), eq(productReviews.tenantId, tenantId)))
    .limit(1);
  if (!r) throw new ReviewError("Review not found.", "NOT_FOUND");
  return r;
}

/** Public reply under the review (empty text removes it). */
export async function replyToReview(tenantId: string, id: string, reply: string): Promise<void> {
  await ownReview(tenantId, id);
  const text = reply.trim().slice(0, 600);
  await getDb()
    .update(productReviews)
    .set({ sellerReply: text || null, sellerReplyAt: text ? new Date() : null })
    .where(and(eq(productReviews.id, id), eq(productReviews.tenantId, tenantId)));
}

/** Hide (with a reason the seller keeps) or show again. Reviews removed by Guma can't be changed. */
export async function setReviewHidden(tenantId: string, id: string, hidden: boolean, reason?: string): Promise<void> {
  const r = await ownReview(tenantId, id);
  if (r.status === "removed") throw new ReviewError("Guma removed this review; it can't be shown again.", "LOCKED");
  const why = (reason ?? "").trim().slice(0, 200);
  if (hidden && why.length < 3) throw new ReviewError("Say why you're hiding it (only you see this).", "INVALID");
  await getDb()
    .update(productReviews)
    .set(hidden ? { status: "hidden", hiddenReason: why } : { status: "published", hiddenReason: null })
    .where(and(eq(productReviews.id, id), eq(productReviews.tenantId, tenantId)));
}

/** Ask Guma to look at it (abuse, spam, personal info). The review stays as it is until ops decide. */
export async function reportReview(tenantId: string, id: string, reason: string): Promise<void> {
  const r = await ownReview(tenantId, id);
  if (r.reportStatus === "open") throw new ReviewError("Already reported — Guma will look at it.", "DUPLICATE");
  if (r.reportStatus) throw new ReviewError("Guma already decided on this review.", "LOCKED");
  const why = reason.trim().slice(0, 200);
  if (why.length < 3) throw new ReviewError("Tell Guma what's wrong with it.", "INVALID");
  await getDb()
    .update(productReviews)
    .set({ reportStatus: "open", reportReason: why, reportedAt: new Date() })
    .where(and(eq(productReviews.id, id), eq(productReviews.tenantId, tenantId)));
}

export interface ReviewStats {
  count: number;
  average: number | null;
  last30: number;
  needsReply: number;
  openReports: number;
}

export async function getTenantReviewStats(tenantId: string): Promise<ReviewStats> {
  const rows = (await getDb().execute(sql`
    select count(*) filter (where status = 'published') as count,
           avg(rating) filter (where status = 'published') as average,
           count(*) filter (where created_at >= now() - interval '30 days') as last30,
           count(*) filter (where status = 'published' and seller_reply is null) as needs_reply,
           count(*) filter (where report_status = 'open') as open_reports
    from product_reviews where tenant_id = ${tenantId}`)) as unknown as Array<Record<string, string | null>>;
  const r = rows[0] ?? {};
  return {
    count: Number(r.count ?? 0),
    average: r.average != null ? Math.round(Number(r.average) * 10) / 10 : null,
    last30: Number(r.last30 ?? 0),
    needsReply: Number(r.needs_reply ?? 0),
    openReports: Number(r.open_reports ?? 0),
  };
}

// ─── Storefront ─────────────────────────────────────────────────────────────────────────────────

export interface RatingSummary {
  average: number;
  count: number;
}

/** Published-review averages per product for one shop (only products that have reviews). */
export async function getProductRatingSummaries(tenantId: string): Promise<Map<string, RatingSummary>> {
  const rows = await getDb()
    .select({ productId: productReviews.productId, average: sql<string>`avg(${productReviews.rating})`, count: sql<string>`count(*)` })
    .from(productReviews)
    .where(and(eq(productReviews.tenantId, tenantId), eq(productReviews.status, "published")))
    .groupBy(productReviews.productId);
  const out = new Map<string, RatingSummary>();
  for (const r of rows) {
    if (r.productId) out.set(r.productId, { average: Math.round(Number(r.average) * 10) / 10, count: Number(r.count) });
  }
  return out;
}

export interface PublicReview {
  id: string;
  rating: number;
  body: string | null;
  photos: string[];
  buyerName: string;
  createdAt: string;
  sellerReply: string | null;
  productTitle?: string | null;
}

export async function listProductReviews(tenantId: string, productId: string, limit = 20): Promise<PublicReview[]> {
  const rows = await getDb()
    .select()
    .from(productReviews)
    .where(and(eq(productReviews.tenantId, tenantId), eq(productReviews.productId, productId), eq(productReviews.status, "published")))
    .orderBy(desc(productReviews.createdAt))
    .limit(Math.min(50, limit));
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    body: r.body,
    photos: r.photosJson ?? [],
    buyerName: r.buyerName,
    createdAt: r.createdAt.toISOString(),
    sellerReply: r.sellerReply,
  }));
}

/** Shop-wide rating plus the newest photo reviews (for the shop's photo strip). */
export async function getShopReviewHighlights(tenantId: string, photoLimit = 8): Promise<{ rating: RatingSummary | null; photoReviews: PublicReview[] }> {
  const db = getDb();
  const [agg] = await db
    .select({ average: sql<string | null>`avg(${productReviews.rating})`, count: sql<string>`count(*)` })
    .from(productReviews)
    .where(and(eq(productReviews.tenantId, tenantId), eq(productReviews.status, "published")));
  const count = Number(agg?.count ?? 0);
  const photoRows = await db
    .select({ r: productReviews, productTitle: products.title })
    .from(productReviews)
    .leftJoin(products, eq(products.id, productReviews.productId))
    .where(
      and(
        eq(productReviews.tenantId, tenantId),
        eq(productReviews.status, "published"),
        sql`jsonb_array_length(${productReviews.photosJson}) > 0`
      )
    )
    .orderBy(desc(productReviews.createdAt))
    .limit(photoLimit);
  return {
    rating: count > 0 ? { average: Math.round(Number(agg!.average) * 10) / 10, count } : null,
    photoReviews: photoRows.map(({ r, productTitle }) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      photos: r.photosJson ?? [],
      buyerName: r.buyerName,
      createdAt: r.createdAt.toISOString(),
      sellerReply: r.sellerReply,
      productTitle,
    })),
  };
}

// ─── Guma ops ───────────────────────────────────────────────────────────────────────────────────

export interface ReportedReviewRow extends SellerReviewRow {
  tenantName: string;
  tenantSlug: string;
  reportReason: string | null;
  reportedAt: string | null;
}

export async function listReportedReviews(status: "open" | "kept" | "removed" = "open", limit = 100): Promise<ReportedReviewRow[]> {
  const rows = await getDb()
    .select({ r: productReviews, productTitle: products.title, orderNumber: orders.orderNumber, tenantName: tenants.name, tenantSlug: tenants.slug })
    .from(productReviews)
    .innerJoin(orders, eq(orders.id, productReviews.orderId))
    .innerJoin(tenants, eq(tenants.id, productReviews.tenantId))
    .leftJoin(products, eq(products.id, productReviews.productId))
    .where(eq(productReviews.reportStatus, status))
    .orderBy(desc(productReviews.reportedAt))
    .limit(limit);
  return rows.map(({ r, productTitle, orderNumber, tenantName, tenantSlug }) => ({
    id: r.id,
    rating: r.rating,
    body: r.body,
    photos: r.photosJson ?? [],
    buyerName: r.buyerName,
    productTitle,
    orderNumber,
    status: r.status,
    hiddenReason: r.hiddenReason,
    sellerReply: r.sellerReply,
    reportStatus: r.reportStatus ?? null,
    createdAt: r.createdAt.toISOString(),
    tenantName,
    tenantSlug,
    reportReason: r.reportReason,
    reportedAt: r.reportedAt?.toISOString() ?? null,
  }));
}

export async function countOpenReviewReports(): Promise<number> {
  const [r] = await getDb().select({ n: sql<string>`count(*)` }).from(productReviews).where(eq(productReviews.reportStatus, "open"));
  return Number(r?.n ?? 0);
}

/** Ops decision: keep (report closed, nothing changes) or remove (hidden for good). */
export async function resolveReviewReport(id: string, decision: "kept" | "removed"): Promise<{ tenantId: string }> {
  const set = decision === "removed" ? { reportStatus: decision, status: "removed" as const } : { reportStatus: decision };
  const [r] = await getDb()
    .update(productReviews)
    .set(set)
    .where(and(eq(productReviews.id, id), eq(productReviews.reportStatus, "open")))
    .returning({ tenantId: productReviews.tenantId });
  if (!r) throw new ReviewError("That report was already decided.", "LOCKED");
  return r;
}

// ─── Review request (timed automation) ──────────────────────────────────────────────────────────

/**
 * Orders delivered/completed 2–14 days ago at shops that turned the recipe on, whose buyer said yes
 * to texts, with no review yet and no review request sent. The caller sends at most one text per order (message_log key).
 */
export async function listReviewRequestCandidates(now = new Date(), limit = 50): Promise<string[]> {
  const rows = (await getDb().execute(sql`
    select o.id from orders o
    join tenants t on t.id = o.tenant_id
    where (t.settings_json -> 'automations' ->> 'review_request') = 'true'
      and coalesce(o.order_state::text, 'open') <> 'cancelled' and o.voided_at is null
      and (o.fulfillment_state::text = 'delivered' or o.order_state::text = 'completed')
      and o.guest_phone is not null
      and coalesce(o.completed_at, o.created_at) between ${new Date(now.getTime() - 14 * 86_400_000).toISOString()}::timestamptz
                                                     and ${new Date(now.getTime() - 2 * 86_400_000).toISOString()}::timestamptz
      and exists (select 1 from order_items i where i.order_id = o.id and i.product_id is not null)
      and not exists (select 1 from product_reviews r where r.order_id = o.id)
      and exists (select 1 from customers c where c.tenant_id = o.tenant_id and c.sms_marketing_opt_in = true
                  and right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = right(regexp_replace(o.guest_phone, '\\D', '', 'g'), 10))
      and not exists (select 1 from message_log m where m.idempotency_key = 'review_request:' || o.id::text || ':1')
    order by o.created_at
    limit ${limit}`)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** All published reviews for the shop's public reviews page, newest first. */
export async function listShopReviews(tenantId: string, limit = 60): Promise<PublicReview[]> {
  const rows = await getDb()
    .select({ r: productReviews, productTitle: products.title })
    .from(productReviews)
    .leftJoin(products, eq(products.id, productReviews.productId))
    .where(and(eq(productReviews.tenantId, tenantId), eq(productReviews.status, "published")))
    .orderBy(desc(productReviews.createdAt))
    .limit(Math.min(200, limit));
  return rows.map(({ r, productTitle }) => ({
    id: r.id,
    rating: r.rating,
    body: r.body,
    photos: r.photosJson ?? [],
    buyerName: r.buyerName,
    createdAt: r.createdAt.toISOString(),
    sellerReply: r.sellerReply,
    productTitle,
  }));
}
