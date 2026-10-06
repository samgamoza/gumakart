import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrderForTracking, ReviewError, submitReview } from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { isReviewPhotoUrlForOrder } from "@/lib/review-uploads";

const schema = z.object({
  tenantSlug: z.string().min(1).max(64),
  orderNumber: z.string().min(1).max(64),
  accessToken: z.string().max(128),
  orderItemId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  body: z.string().max(1000).optional(),
  photos: z.array(z.string().max(300)).max(3).optional(),
});

/** Phase 23: a buyer rates one item on their delivered order (verified by the order link). */
export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`review:${clientIpFrom(request)}`, { limit: 20, windowSeconds: 60 });
    if (!limited.allowed) return NextResponse.json({ ok: false, error: "Too many tries. Wait a minute." }, { status: 429 });
    const body = schema.parse(await request.json());
    const order = await getOrderForTracking(body.tenantSlug, body.orderNumber, body.accessToken);
    if (!order) return NextResponse.json({ ok: false, error: "Open this order from the link in your SMS, then try again." }, { status: 404 });
    const photos = (body.photos ?? []).filter((u) => isReviewPhotoUrlForOrder(u, body.tenantSlug, body.orderNumber));
    if (photos.length !== (body.photos ?? []).length) {
      return NextResponse.json({ ok: false, error: "Upload the photos again from this page." }, { status: 400 });
    }
    const saved = await submitReview({ orderId: order.orderId, orderItemId: body.orderItemId, rating: body.rating, body: body.body, photos });
    return NextResponse.json({ ok: true, id: saved.id });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Pick 1 to 5 stars." }, { status: 400 });
    if (error instanceof ReviewError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.code === "DUPLICATE" ? 409 : 400 });
    }
    console.error("[reviews]", error);
    return NextResponse.json({ ok: false, error: "Could not save your review." }, { status: 500 });
  }
}
