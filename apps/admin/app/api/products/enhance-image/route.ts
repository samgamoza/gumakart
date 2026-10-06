import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readProductImageBuffer,
  saveEnhancedProductImage,
} from "@/lib/product-uploads";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { enhanceProductPhoto } from "@/lib/product-enhance";
import { recordAiUsage } from "@gumakart/db";
import { assertAiQuota } from "@/lib/agents/usage-gate";

export const maxDuration = 120;

const enhanceSchema = z.object({
  imageUrl: z.string().min(1).max(2048),
});

export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = enhanceSchema.parse(await request.json());

    // Phase 33 (H9): remove.bg is paid per photo, so each one uses a monthly AI generation
    // (Free 5, Growth 100, Pro 500). The local model in development is free and isn't counted.
    const paid = Boolean(process.env.REMOVE_BG_API_KEY);
    if (paid) {
      const quota = await assertAiQuota(session.tenantId, "generation");
      if (!quota.allowed) {
        return NextResponse.json({ ok: false, error: quota.reason, upgradeRequired: true }, { status: 402 });
      }
    }

    const inputBuffer = await readProductImageBuffer(session.tenantId, body.imageUrl);
    const enhancedBuffer = await enhanceProductPhoto(inputBuffer);
    if (paid) {
      await recordAiUsage(session.tenantId, { incrementGenerations: true, tokensUsed: 0 }).catch((e) =>
        console.error("[products/enhance-image] usage", e)
      );
    }
    const saved = await saveEnhancedProductImage(session.tenantId, enhancedBuffer);

    return NextResponse.json({
      ok: true,
      url: saved.url,
      originalUrl: body.imageUrl,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: error.errors[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }
    if (error instanceof Error) {
      console.error("[products/enhance-image POST]", error);
      return NextResponse.json(
        { ok: false, error: error.message || "Background removal failed." },
        { status: 500 }
      );
    }
    console.error("[products/enhance-image POST]", error);
    return NextResponse.json({ ok: false, error: "Background removal failed." }, { status: 500 });
  }
}
