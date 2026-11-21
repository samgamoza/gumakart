import { NextResponse } from "next/server";
import { z } from "zod";
import { productPhotoPayloadSchema, videoAdPayloadSchema, voiceClonePayloadSchema } from "@gumakart/ai/studio";
import { enqueueAiMediaJob, getMerchantEntitlements, getProductForTenant, listAiMediaJobs } from "@gumakart/db";
import { AI_SUITE_TIERS, isAiSuiteTierId } from "@gumakart/plans";
import { ApiAuthError, assertCan, requireTenantSession } from "@/lib/api-auth";
import { assertMediaOwned, denialResponse, storeUrlFor, StudioInputError } from "@/lib/marketing-studio";

/** Marketing Studio jobs + this month's credits. The page polls this while a render is running. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    assertCan(session, "marketing.manage");
    const [ent, jobs] = await Promise.all([getMerchantEntitlements(session.tenantId), listAiMediaJobs(session.tenantId, 30)]);
    const tier = ent && isAiSuiteTierId(ent.tierId) ? AI_SUITE_TIERS[ent.tierId] : null;
    return NextResponse.json({
      ok: true,
      tier: tier ? { id: tier.id, name: tier.displayName, grandfathered: tier.isGrandfathered } : null,
      credits: ent
        ? {
            photo: { limit: ent.photoCreditsLimit, used: ent.photoCreditsUsedNow, remaining: ent.photoCreditsRemaining },
            video: { limit: ent.videoCreditsLimit, used: ent.videoCreditsUsedNow, remaining: ent.videoCreditsRemaining },
            voiceClone: ent.voiceCloneEnabled,
          }
        : null,
      jobs: jobs.map((j) => ({
        id: j.id,
        jobType: j.jobType,
        status: j.status,
        productId: j.productId,
        outputs: j.outputUrls,
        error: j.status === "failed" ? j.errorMessage : null,
        creditStatus: j.creditStatus,
        createdAt: j.createdAt,
        completedAt: j.completedAt,
        input: summarize(j.inputPayload),
      })),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[ai-media/jobs GET]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}

/** Only what the gallery shows — never the full payload. */
function summarize(p: Record<string, unknown>) {
  return {
    scene: typeof p.scene === "string" ? p.scene : undefined,
    aspects: Array.isArray(p.aspects) ? p.aspects : undefined,
    productTitle: typeof p.productTitle === "string" ? p.productTitle : undefined,
    durationSec: typeof p.durationSec === "number" ? p.durationSec : undefined,
    voiceStyle: typeof p.voiceStyle === "string" ? p.voiceStyle : undefined,
  };
}

const requestSchema = z.discriminatedUnion("jobType", [
  z.object({ jobType: z.literal("product_photo"), productId: z.string().uuid().optional(), idempotencyKey: z.string().max(100).optional(), payload: z.unknown() }),
  z.object({ jobType: z.literal("video_ad"), productId: z.string().uuid().optional(), idempotencyKey: z.string().max(100).optional(), payload: z.unknown() }),
  z.object({ jobType: z.literal("voice_clone"), idempotencyKey: z.string().max(100).optional(), payload: z.unknown() }),
]);

export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    assertCan(session, "marketing.manage");
    const body = requestSchema.parse(await request.json());
    const productId = "productId" in body ? body.productId : undefined;
    const product = productId ? await getProductForTenant(session.tenantId, productId) : null;
    if (productId && !product) return NextResponse.json({ ok: false, error: "Product not found." }, { status: 404 });

    let payload: Record<string, unknown>;
    if (body.jobType === "product_photo") {
      const p = productPhotoPayloadSchema.parse({ ...(body.payload as object), productTitle: product?.title ?? (body.payload as { productTitle?: string })?.productTitle });
      assertMediaOwned(session.tenantId, [p.sourceImageUrl]);
      payload = p;
    } else if (body.jobType === "video_ad") {
      // Shop name and store link come from the session, never from the browser.
      const p = videoAdPayloadSchema.parse({
        ...(body.payload as object),
        productTitle: (body.payload as { productTitle?: string })?.productTitle ?? product?.title,
        shopName: session.tenantName,
        storeUrl: storeUrlFor(session.tenantSlug),
      });
      assertMediaOwned(session.tenantId, [...p.imageUrls, p.voiceSampleUrl]);
      if (p.voiceStyle === "custom") {
        const ent = await getMerchantEntitlements(session.tenantId);
        if (!ent?.voiceCloneEnabled) return denialResponse("voice_clone_not_included_video");
      }
      payload = p;
    } else {
      const p = voiceClonePayloadSchema.parse(body.payload);
      assertMediaOwned(session.tenantId, [p.sampleUrl]);
      payload = p;
    }

    const result = await enqueueAiMediaJob({
      tenantId: session.tenantId,
      jobType: body.jobType,
      productId: productId ?? null,
      inputPayload: payload,
      idempotencyKey: body.idempotencyKey ?? null,
    });
    if (!result.ok) return denialResponse(result.reason);
    return NextResponse.json({ ok: true, jobId: result.job.id, status: result.job.status, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof StudioInputError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    console.error("[ai-media/jobs POST]", error);
    return NextResponse.json({ ok: false, error: "Couldn't start the render. Try again." }, { status: 500 });
  }
}
