import { NextResponse } from "next/server";
import { getAutomationSummary, getTenantSettings, listTenantMessages } from "@gumakart/db";
import {
  abandonedCheckoutSms,
  BUYER_RECIPES,
  deliveredSms,
  isRecipeEnabled,
  orderCreatedSms,
  outForDeliverySms,
  paymentConfirmedSms,
  riderBookedSms,
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
  };
}
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

/** Automations page: recipe switches, 30-day numbers, and the shop's SMS log. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    const [record, summary, messages] = await Promise.all([
      getTenantSettings(session.tenantId),
      getAutomationSummary(session.tenantId),
      listTenantMessages(session.tenantId, 50),
    ]);
    if (!record) return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    const settings = record.settings ?? {};
    const sample = examples(record.name);
    return NextResponse.json({
      ok: true,
      recipes: BUYER_RECIPES.map((r) => ({ ...r, enabled: isRecipeEnabled(settings.automations, r.id), example: sample[r.id] })),
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
