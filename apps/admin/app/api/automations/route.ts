import { NextResponse } from "next/server";
import { getAutomationSummary, getTenantPlanId, getTenantSettings, listTenantMessages } from "@gumakart/db";
import {
  abandonedCheckoutSms,
  BUYER_RECIPES,
  deliveredSms,
  isRecipeEnabled,
  orderCreatedSms,
  outForDeliverySms,
  paymentConfirmedSms,
  reviewRequestSms,
  riderBookedSms,
  thankYouSms,
  unpaidReminderSms,
  type BuyerRecipe,
} from "@gumakart/services";

function examples(shopName: string): Record<BuyerRecipe, string> {
  const c = {
    shopName,
    orderNumber: "ABC-0012",
    total: 1290,
    paymentMethod: "cod",
    deliveryType: "delivery",
    orderUrl: "kart.guma.one/…",
    courier: "Lalamove",
    codDue: true,
  };
  return {
    order_created: orderCreatedSms(c),
    payment_confirmed: paymentConfirmedSms({ ...c, paymentMethod: "gcash" }),
    shipped: riderBookedSms(c),
    out_for_delivery: outForDeliverySms(c),
    delivered: deliveredSms(c),
    abandoned_checkout: `${abandonedCheckoutSms({ shopName, productTitle: "Canvas Backpack", url: "kart.guma.one/c/…", step: 1 })} Stop reminders: kart.guma.one/stop/…`,
    unpaid_reminder: `${unpaidReminderSms({ ...c, paymentMethod: "gcash" })} Stop reminders: kart.guma.one/stop/…`,
    review_request: `${reviewRequestSms(c)} Stop reminders: kart.guma.one/stop/…`,
    thank_you: `${thankYouSms({ ...c, buyerName: "Ana", shopUrl: "kart.guma.one/…" })} Stop reminders: kart.guma.one/stop/…`,
  };
}
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { FUNNEL_RECIPES } from "@gumakart/services";
import { planHasFunnel } from "@/lib/funnel-plan";

/** Automations page: recipe switches, 30-day numbers, and the shop's SMS log. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    const [record, summary, messages, plan] = await Promise.all([
      getTenantSettings(session.tenantId),
      getAutomationSummary(session.tenantId),
      listTenantMessages(session.tenantId, 50),
      getTenantPlanId(session.tenantId),
    ]);
    const funnel = planHasFunnel(plan);
    if (!record) return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    const settings = record.settings ?? {};
    const sample = examples(record.name);
    return NextResponse.json({
      ok: true,
      // Pro funnel recipes show as locked (and never send) below the Pro plan.
      recipes: BUYER_RECIPES.map((r) => {
        const locked = FUNNEL_RECIPES.has(r.id) && !funnel;
        return { ...r, locked, enabled: !locked && isRecipeEnabled(settings.automations, r.id), example: sample[r.id] };
      }),
      funnel,
      seller: {
        smsOnNewOrder: settings.notifications?.smsOnNewOrder === true,
        mobile: settings.contact?.mobile ?? null,
      },
      smsLive: Boolean(process.env.SEMAPHORE_API_KEY?.trim()),
      // Phase 13: email copies of the order texts (free; only when the buyer typed an email).
      email: { enabled: settings.automations?.email_copies !== false, live: Boolean(process.env.RESEND_API_KEY?.trim()) },
      summary,
      messages,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[automations GET]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
