import { NextResponse } from "next/server";
import { getOrderForTracking, reviewEligibility } from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { saveReviewPhoto } from "@/lib/review-uploads";

/** Phase 23: one review photo from the buyer's order link (shrunk in the browser first). */
export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`review-photo:${clientIpFrom(request)}`, { limit: 12, windowSeconds: 60 });
    if (!limited.allowed) return NextResponse.json({ ok: false, error: "Too many uploads. Wait a minute." }, { status: 429 });
    const form = await request.formData();
    const tenantSlug = String(form.get("tenantSlug") ?? "").trim().slice(0, 64);
    const orderNumber = String(form.get("orderNumber") ?? "").trim().slice(0, 64);
    const accessToken = String(form.get("accessToken") ?? "").trim().slice(0, 128);
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Choose a photo." }, { status: 400 });
    const order = await getOrderForTracking(tenantSlug, orderNumber, accessToken);
    if (!order) return NextResponse.json({ ok: false, error: "Open this order from the link in your SMS, then try again." }, { status: 404 });
    const check = reviewEligibility({ orderState: order.orderState, fulfillmentState: order.fulfillmentState, createdAt: new Date(order.createdAt) });
    if (!check.ok) return NextResponse.json({ ok: false, error: check.reason }, { status: 400 });
    const saved = await saveReviewPhoto({ tenantSlug, orderNumber, file });
    return NextResponse.json({ ok: true, url: saved.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/^(Use a|Photo must)/.test(message)) return NextResponse.json({ ok: false, error: message }, { status: 400 });
    console.error("[reviews/photo]", error);
    return NextResponse.json({ ok: false, error: "Could not upload the photo." }, { status: 500 });
  }
}
