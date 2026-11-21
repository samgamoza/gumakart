import { NextResponse } from "next/server";
import { z } from "zod";
import { COPY_ANGLES, COPY_PLATFORMS, PAYMENT_METHODS, runTaglishCopywriter, type CopywriterOutput } from "@gumakart/ai";
import { getProductForTenant } from "@gumakart/db";
import { ApiAuthError, assertCan, requireTenantSession } from "@/lib/api-auth";
import { runAiForTenant } from "@/lib/ai-assist";
import { storefrontBase, storeUrlFor } from "@/lib/marketing-studio";

const schema = z.object({
  productId: z.string().uuid().optional(),
  productTitle: z.string().trim().min(2).max(160).optional(),
  price: z.number().positive().max(10_000_000).nullable().optional(),
  promoPrice: z.number().positive().max(10_000_000).nullable().optional(),
  details: z.string().trim().max(800).optional(),
  platform: z.enum(COPY_PLATFORMS),
  angle: z.enum(COPY_ANGLES).default("auto"),
  stockLeft: z.number().int().min(0).max(100_000).nullable().optional(),
  freeShipping: z.boolean().default(false),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1).max(5).default(["cod", "gcash"]),
  language: z.enum(["taglish", "tagalog", "english"]).default("taglish"),
});

/**
 * Taglish viral copywriter (Phase 2.3): one monthly AI generation. Qwen3 on the GPU node via the
 * bridge; the cloud model answers when the node is offline (D1).
 */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    assertCan(session, "marketing.manage");
    const body = schema.parse(await request.json());

    let title = body.productTitle;
    let price = body.price ?? null;
    let details = body.details ?? "";
    let link = storeUrlFor(session.tenantSlug);
    if (body.productId) {
      const product = await getProductForTenant(session.tenantId, body.productId);
      if (!product) return NextResponse.json({ ok: false, error: "Product not found." }, { status: 404 });
      title ??= product.title;
      price ??= Number(product.basePrice) || null;
      details ||= (product.descriptionHtml ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
      link = `${storefrontBase()}/${session.tenantSlug}/products/${product.slug}`;
    }
    if (!title) return NextResponse.json({ ok: false, error: "Pick a product or type what you're selling." }, { status: 400 });

    let servedBy = "cloud";
    const result = await runAiForTenant<CopywriterOutput>(session.tenantId, {
      label: "copywriter",
      pool: "generation",
      run: async (plan, tokensUsedThisMonth) => {
        const r = await runTaglishCopywriter(
          {
            shopName: session.tenantName,
            productTitle: title!,
            price,
            promoPrice: body.promoPrice ?? null,
            details: details || undefined,
            link,
            platform: body.platform,
            angle: body.angle,
            stockLeft: body.stockLeft ?? null,
            freeShipping: body.freeShipping,
            paymentMethods: body.paymentMethods,
            language: body.language,
          },
          {
            tenantId: session.tenantId,
            plan,
            tokensUsedThisMonth,
            onFallback: (reason, error) => {
              if (reason !== "not_configured") console.warn(`[ai/copywriter] GPU node not used (${reason})`, error instanceof Error ? error.message : "");
            },
          }
        );
        servedBy = r.servedBy;
        return { output: r.output, tokensUsed: r.tokensUsed, model: r.model };
      },
    });
    if (!result.ok) return result.response;
    return NextResponse.json({ ok: true, copy: result.output, link, servedBy });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    console.error("[ai/copywriter]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
