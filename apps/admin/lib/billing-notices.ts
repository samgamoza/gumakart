import { markNoticeEmailed, runPlanLifecycle, type BillingNoticeToSend, PLAN_GRACE_DAYS } from "@gumakart/db";
import { planDisplayName, normalizePlanId } from "@gumakart/plans";
import { sendTransactionalEmail } from "@gumakart/services";
import { adminBaseUrl } from "@/lib/kyc-url";

const day = (d: Date) => d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric" });

export function billingNoticeEmail(n: BillingNoticeToSend, renewUrl: string): { subject: string; text: string } {
  const plan = planDisplayName(normalizePlanId(n.plan));
  const grace = new Date(n.periodEnd.getTime() + PLAN_GRACE_DAYS * 86_400_000);
  const days = n.kind === "reminder_7" ? 7 : n.kind === "reminder_3" ? 3 : 1;
  if (n.kind === "expired") {
    return {
      subject: `${n.shopName}: your ${plan} plan ended — everything stays on until ${day(grace)}`,
      text: `Hi! Your Guma Kart ${plan} plan for ${n.shopName} ended on ${day(n.periodEnd)}.\n\nNothing changes yet: all your ${plan} features stay on until ${day(grace)}. Renew before then to keep them:\n${renewUrl}\n\n— Guma Kart`,
    };
  }
  if (n.kind === "downgraded") {
    return {
      subject: `${n.shopName} is now on the Free plan`,
      text: `Hi! ${n.shopName} moved to the Free plan because the ${plan} plan wasn't renewed within ${PLAN_GRACE_DAYS} days.\n\nYour products, orders, customers and settings are all safe. Renew any time to switch ${plan} features back on:\n${renewUrl}\n\n— Guma Kart`,
    };
  }
  return {
    subject: `${n.shopName}: your ${plan} plan ends in ${days} day${days === 1 ? "" : "s"}`,
    text: `Hi! Your Guma Kart ${plan} plan for ${n.shopName} ends on ${day(n.periodEnd)}.\n\nRenew in a minute with GCash, Maya or card:\n${renewUrl}\n\nIf you don't, everything stays on for ${PLAN_GRACE_DAYS} more days, then the shop moves to Free (nothing is deleted).\n\n— Guma Kart`,
  };
}

/** Hourly: reminders, grace notices and downgrades, with an email to the owner (ready to hook up: Resend). */
export async function runBilling(now = new Date()) {
  const { notices, downgraded } = await runPlanLifecycle(now);
  const renewUrl = `${adminBaseUrl()}/settings/subscription`;
  let emailed = 0;
  for (const n of notices) {
    if (!n.ownerEmail) continue;
    const mail = billingNoticeEmail(n, renewUrl);
    const res = await sendTransactionalEmail({ to: n.ownerEmail, ...mail, tags: [{ name: "kind", value: `billing_${n.kind}` }] });
    if (res.sent) {
      emailed += 1;
      await markNoticeEmailed(n.id);
    }
  }
  return { notices: notices.length, emailed, downgraded };
}
