import { NextResponse } from "next/server";
import { z } from "zod";
import { createPlanPayment, getTenantSettings } from "@gumakart/db";
import { canPurchasePlan, PAID_PLAN_PRICES_PHP, tierDisplayName } from "@gumakart/plans";
import {
  createLogger,
  createPayMongoClient,
  type PayMongoMethod,
} from "@gumakart/services";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { adminBaseUrl } from "@/lib/kyc-url";

const log = createLogger("billing:upgrade");

const upgradeSchema = z.object({
  // AI suite Phase 5.3 (D2): the new tiers are sold; growth / pro only renew for grandfathered shops.
  plan: z.enum(["starter", "pro_live", "enterprise_vibe", "growth", "pro"]),
  method: z.enum(["gcash", "paymaya", "card"]).default("gcash"),
});

/**
 * Starts a PayMongo hosted-checkout payment for a plan upgrade. The PayMongo webhook applies
 * the plan once the payment lands, so nothing is granted here.
 */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    if (process.env.NEXT_PUBLIC_PLAN_BILLING_ENABLED !== "true") {
      return NextResponse.json(
        { ok: false, error: "Paid plans are coming soon." },
        { status: 503 }
      );
    }
    const body = upgradeSchema.parse(await request.json());

    const settings = await getTenantSettings(session.tenantId);
    if (!canPurchasePlan(settings?.subscriptionPlan, body.plan)) {
      return NextResponse.json(
        { ok: false, error: `${tierDisplayName(body.plan)} is no longer sold. Pick Starter, Pro Live or Enterprise Vibe.` },
        { status: 400 }
      );
    }
    const amountPhp = PAID_PLAN_PRICES_PHP[body.plan];
    if (!amountPhp) {
      return NextResponse.json({ ok: false, error: "Unknown plan." }, { status: 400 });
    }
    const planName = tierDisplayName(body.plan);

    // PayMongo hosted checkout; the webhook applies the plan once it's paid.
    const returnUrl = `${adminBaseUrl()}/settings/subscription`;
    const checkout = await createPayMongoClient().createCheckoutSession({
      amountCentavos: amountPhp * 100,
      lineItemName: `Guma Kart ${planName} plan (30 days)`,
      description: `Guma Kart ${planName} plan (30 days) — ${session.tenantName}`,
      methods: [body.method as PayMongoMethod],
      referenceNumber: `plan-${session.tenantSlug}-${Date.now()}`,
      successUrl: `${returnUrl}?payment=success`,
      cancelUrl: `${returnUrl}?payment=cancelled`,
      metadata: {
        purpose: "plan_upgrade",
        tenant_id: session.tenantId,
        plan: body.plan,
      },
    });

    await createPlanPayment({
      tenantId: session.tenantId,
      plan: body.plan,
      amount: amountPhp.toFixed(2),
      gatewayIntentId: checkout.paymentIntentId,
    });

    return NextResponse.json({ ok: true, redirectUrl: checkout.checkoutUrl });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
    }
    log.error("Plan upgrade failed", error);
    return NextResponse.json(
      { ok: false, error: "Could not start the payment. Try again shortly." },
      { status: 502 }
    );
  }
}
