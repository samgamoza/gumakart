import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantPlanId, listChatMatchableProducts } from "@gumakart/db";
import type { PromoOutput } from "@gumakart/ai";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { runAssistForTenant } from "@/lib/ai-assist";
import { segmentSchema } from "@/lib/campaign-api";
import { FUNNEL_UPGRADE_MESSAGE, planHasFunnel } from "@/lib/funnel-plan";

type Segment = z.infer<typeof segmentSchema>;

/** The chosen buyers in plain words, for the AI prompt. */
function audienceOf(s: Segment): string {
  switch (s.kind) {
    case "repeat":
      return "repeat buyers (ordered more than once)";
    case "vip":
      return `VIP buyers who spent at least P${s.minSpend ?? 3000}`;
    case "lapsed":
      return `past buyers who haven't ordered in ${s.days ?? 60} days`;
    case "new":
      return `new buyers whose first order was in the last ${s.days ?? 30} days`;
    case "channel":
      return `buyers who ordered through ${s.channel ?? "social media"}`;
    case "suki":
      return `loyal suki buyers (${s.minTier ?? "silver"} tier and up) who haven't ordered in ${s.days ?? 45} days`;
    default:
      return "all past buyers";
  }
}

/**
 * Pro funnel: "Write it for me" — three SMS campaign texts for the chosen buyers, from the shop's
 * real products and the seller's own offer. Nothing is sent: the seller picks, edits and sends.
 */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = z.object({ segment: segmentSchema, offer: z.string().trim().max(200).optional() }).parse(await request.json());
    if (!planHasFunnel(await getTenantPlanId(session.tenantId))) {
      return NextResponse.json({ ok: false, error: FUNNEL_UPGRADE_MESSAGE, upgradeRequired: true }, { status: 402 });
    }
    const products = (await listChatMatchableProducts(session.tenantId, 50))
      .filter((p) => p.available && p.price > 0)
      .slice(0, 5)
      .map((p) => ({ title: p.title, price: p.price }));
    const result = await runAssistForTenant<PromoOutput>(session.tenantId, "promo", {
      shopName: session.tenantName,
      audience: audienceOf(body.segment),
      offer: body.offer || undefined,
      products,
    });
    if (!result.ok) return result.response;
    if (result.output.options.length === 0) {
      return NextResponse.json({ ok: false, error: "The AI couldn't write a safe text this time. Try again, or add your offer." }, { status: 422 });
    }
    return NextResponse.json({ ok: true, options: result.output.options });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Pick who gets it first." }, { status: 400 });
    console.error("[campaigns/write]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
