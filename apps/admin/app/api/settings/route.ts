import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getPlatformSetting,
  normalizeChatUrl,
  normalizePhMobile,
  getTenantSettings,
  PAYMENTS_MODE_KEY,
  resolveTenantPaymentsSettings,
  updateTenantSettings,
} from "@gumakart/db";
import { resolvePaymentsMode } from "@gumakart/services";
import { ApiAuthError, assertCan, requireTenantSession } from "@/lib/api-auth";
import { birMissing } from "@gumakart/db";
import { recordActivity } from "@/lib/activity";

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  legalName: z.string().max(255).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  localeDefault: z.enum(["en", "fil", "taglish"]).optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().max(64).optional(),
  tagline: z.string().max(160).optional(),
  promoTitle: z.string().max(120).optional(),
  promoSubtitle: z.string().max(160).optional(),
  // NOTE: subscriptionPlan is intentionally NOT accepted here. Plan changes
  // must go through billing; accepting it from the client lets any tenant
  // self-upgrade to paid plans for free.
  settings: z
    .object({
      codEnabled: z.boolean().optional(),
      autoAcceptOrders: z.boolean().optional(),
      minOrderAmount: z.number().min(0).max(999999).optional(),
      delivery: z
        .object({
          provider: z.enum(["lalamove", "grab", "manual"]).optional(),
          flatRate: z.number().min(0).max(99999).optional(),
          freeDeliveryMin: z.number().min(0).max(999999).optional(),
          pickupEnabled: z.boolean().optional(),
          deliveryNotes: z.string().max(500).optional(),
          pickupAddress: z.string().max(500).optional(),
        })
        .optional(),
      notifications: z
        .object({
          emailOnNewOrder: z.boolean().optional(),
          smsOnNewOrder: z.boolean().optional(),
          emailOnOrderStatus: z.boolean().optional(),
          marketingEmails: z.boolean().optional(),
        })
        .optional(),
      whatsapp: z
        .object({
          enabled: z.boolean().optional(),
          phone: z.string().max(20).optional(),
          greeting: z.string().max(500).optional(),
        })
        .optional(),
      tracking: z
        .object({
          // Strict formats: these IDs are rendered into inline <script> tags on
          // the public storefront, so anything looser is a stored-XSS vector.
          facebookPixelId: z
            .string()
            .regex(/^\d{5,20}$/, "Facebook Pixel ID must be numeric.")
            .or(z.literal(""))
            .optional(),
          googleAnalyticsId: z
            .string()
            .regex(
              /^(G|UA|AW|GTM)-[A-Za-z0-9-]{4,20}$/,
              "Enter a valid Google tag ID (e.g. G-XXXXXXXXXX)."
            )
            .or(z.literal(""))
            .optional(),
          tiktokPixelId: z
            .string()
            .regex(/^[A-Za-z0-9]{10,30}$/, "Enter a valid TikTok Pixel ID.")
            .or(z.literal(""))
            .optional(),
        })
        .optional(),
      wallet: z
        .object({
          autoPayoutEnabled: z.boolean().optional(),
          payoutMethod: z.enum(["gcash", "maya", "bank"]).optional(),
          payoutAccount: z.string().min(5).max(64).optional(),
          payoutAccountName: z.string().min(2).max(120).optional(),
        })
        .optional(),
      checkout: z
        .object({
          unpaidExpiryHours: z.number().int().min(1).max(72).optional(),
        })
        .optional(),
      payments: z
        .object({
          // mode is Platform-only (PayMongo activation). Sellers may only edit receiving accounts.
          receiving: z
            .object({
              gcashNumber: z.string().max(32).optional(),
              gcashName: z.string().max(120).optional(),
              mayaNumber: z.string().max(32).optional(),
              mayaName: z.string().max(120).optional(),
              bankName: z.string().max(120).optional(),
              bankAccountName: z.string().max(120).optional(),
              bankAccountNumber: z.string().max(64).optional(),
            })
            .optional(),
        })
        .optional(),
      contact: z
        .object({
          // "" clears it; anything else must be a PH mobile (09XXXXXXXXX / +639XXXXXXXXX).
          mobile: z
            .string()
            .max(20)
            .transform((v, ctx) => {
              if (!v.trim()) return "";
              const n = normalizePhMobile(v);
              if (!n) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a PH mobile like 0917 123 4567." });
                return z.NEVER;
              }
              return n;
            })
            .optional(),
        })
        .optional(),
      social: z
        .object({
          sellChannels: z
            .array(z.enum(["facebook", "instagram", "tiktok", "messenger", "shopee", "lazada", "other"]))
            .max(7)
            .transform((list) => Array.from(new Set(list)))
            .optional(),
          chatUrl: z
            .string()
            .max(300)
            .transform((v, ctx) => {
              if (!v.trim()) return "";
              const n = normalizeChatUrl(v);
              if (!n) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a link like m.me/yourpage." });
                return z.NEVER;
              }
              return n;
            })
            .optional(),
        })
        .optional(),
      pos: z
        .object({
          vatRegistered: z.boolean().optional(),
          vatInclusive: z.boolean().optional(),
          vatRate: z.number().min(0).max(0.3).optional(),
          bir: z
            .object({
              enabled: z.boolean().optional(),
              registeredName: z.string().trim().max(120).optional(),
              tradeName: z.string().trim().max(120).optional(),
              tin: z.string().trim().regex(/^[0-9-]{0,20}$/, "TIN: digits and dashes only.").optional(),
              branchCode: z.string().trim().max(10).optional(),
              address: z.string().trim().max(240).optional(),
              min: z.string().trim().max(40).optional(),
              serialNo: z.string().trim().max(40).optional(),
              ptuNo: z.string().trim().max(60).optional(),
              ptuDate: z.string().trim().max(20).optional(),
              accreditationNo: z.string().trim().max(60).optional(),
              invoicePrefix: z.string().trim().regex(/^[A-Za-z0-9-]{0,6}$/, "Prefix: up to 6 letters/numbers.").optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
      inventory: z
        .object({ lowStockThreshold: z.number().int().min(0).max(1000).optional() })
        .strict()
        .optional(),
      automations: z
        .object({
          order_created: z.boolean().optional(),
          payment_confirmed: z.boolean().optional(),
          shipped: z.boolean().optional(),
          out_for_delivery: z.boolean().optional(),
          delivered: z.boolean().optional(),
          abandoned_checkout: z.boolean().optional(),
          unpaid_reminder: z.boolean().optional(),
        })
        .strict()
        .optional(),
      shopAssistant: z
        .object({
          enabled: z.boolean().optional(),
          name: z.string().max(80).optional(),
          greeting: z.string().max(500).optional(),
          tone: z.enum(["friendly_taglish", "professional_en", "gen_z_taglish"]).optional(),
          humanInbox: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

export async function GET() {
  try {
    const session = await requireTenantSession();
    const settings = await getTenantSettings(session.tenantId);
    if (!settings) {
      return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    }
    const payments = resolveTenantPaymentsSettings(
      settings.settings as Record<string, unknown>
    );
    const platformMode = await getPlatformSetting(PAYMENTS_MODE_KEY);
    const effectivePaymentsMode = resolvePaymentsMode({
      settingsMode: payments.mode,
      envMode: platformMode,
    });
    // Phase 10: payout details are for the owner only.
    const visible =
      session.shopRole === "owner"
        ? settings
        : { ...settings, settings: { ...settings.settings, wallet: undefined } };
    return NextResponse.json({
      ok: true,
      settings: visible,
      effectivePaymentsMode,
      /** True when this shop has an explicit Platform override (not just env/global). */
      paymentsModeSetByPlatform: Boolean(payments.mode),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[settings GET]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireTenantSession();
    const raw = await request.json();
    // Reject attempts to self-activate PayMongo via raw JSON even if schema drifts.
    if (raw?.settings?.payments?.mode !== undefined) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Checkout payments mode (including PayMongo) is managed by Guma Platform ops. You can only update receiving accounts.",
          code: "PAYMENTS_MODE_PLATFORM_ONLY",
        },
        { status: 403 }
      );
    }
    const body = patchSchema.parse(raw);
    if (body.settings?.payments) assertCan(session, "settings.payments");
    // Phase 11: BIR numbering is the owner's legal call — owner only, and only complete.
    if (body.settings?.pos?.bir) {
      assertCan(session, "settings.payments");
      if (body.settings.pos.bir.enabled) {
        const current = (await getTenantSettings(session.tenantId))?.settings.pos?.bir ?? {};
        const missing = birMissing({ ...current, ...body.settings.pos.bir });
        if (missing.length) {
          return NextResponse.json({ ok: false, error: `Fill in first: ${missing.join(", ")}.` }, { status: 400 });
        }
      }
    }
    if (body.settings?.wallet) assertCan(session, "billing.manage");
    const updated = await updateTenantSettings(session.tenantId, body);
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    }
    const sections = [
      ...Object.keys(body).filter((k) => k !== "settings"),
      ...Object.keys(body.settings ?? {}),
    ];
    if (sections.length) {
      await recordActivity(session, {
        action: body.settings?.payments ? "settings.payments_changed" : "settings.changed",
        entityType: "settings",
        summary: `Changed shop settings: ${sections.slice(0, 6).join(", ")}`,
      });
    }
    return NextResponse.json({ ok: true, settings: updated });
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
    console.error("[settings PATCH]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
