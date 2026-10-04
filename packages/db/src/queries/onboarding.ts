import { and, count, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import { checkoutLinks, productVariants, products, tenants } from "../schema/index";
import { checkoutFromLegacySettings, normalizeCheckoutJson } from "../types/tenant-checkout";
import type { TenantSellChannel, TenantSettingsJson } from "../types/tenant-settings";

/**
 * Plan §9 — 4 steps to a shareable link:
 *   1 Your business (at signup)  2 First product  3 How you get paid  4 Your link is ready
 * Progress lives in tenants.settings_json.onboarding. Everything else (pickup address,
 * delivery fees, the online store) is asked for later, when it's needed.
 */

export const SELL_CHANNELS: TenantSellChannel[] = [
  "facebook",
  "instagram",
  "tiktok",
  "messenger",
  "shopee",
  "lazada",
  "other",
];

/** 0917 123 4567 / +63 917… → 09171234567, or null. */
export function normalizePhMobile(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return digits;
  if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^9\d{9}$/.test(digits)) return `0${digits}`;
  return null;
}

/** "m.me/mypage" → "https://m.me/mypage"; rejects anything that isn't an http(s) link. */
export function normalizeChatUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, "")}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString().slice(0, 300);
  } catch {
    return null;
  }
}

/** Shallow-merges top-level keys into settings_json (each key replaced as a whole). */
async function mergeSettingsKeys(tenantId: string, patch: Partial<TenantSettingsJson>): Promise<void> {
  const db = getDb();
  await db
    .update(tenants)
    .set({
      settingsJson: sql`coalesce(${tenants.settingsJson}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
}

export async function saveBusinessProfile(
  tenantId: string,
  input: { mobile?: string | null; sellChannels?: string[] | null; chatUrl?: string | null }
): Promise<void> {
  const channels = (input.sellChannels ?? []).filter((c): c is TenantSellChannel =>
    SELL_CHANNELS.includes(c as TenantSellChannel)
  );
  const mobile = normalizePhMobile(input.mobile);
  const chatUrl = normalizeChatUrl(input.chatUrl);
  await mergeSettingsKeys(tenantId, {
    contact: mobile ? { mobile } : {},
    social: { sellChannels: [...new Set(channels)], ...(chatUrl ? { chatUrl } : {}) },
    onboarding: { step: 1 },
  });
}

export type OnboardingStep = "product" | "payments" | "link" | "done";

export interface OnboardingState {
  step: OnboardingStep;
  shop: { name: string; slug: string };
  sellChannels: TenantSellChannel[];
  chatUrl: string | null;
  products: Array<{ id: string; title: string; price: string; imageUrl: string | null; stockQty: number }>;
  payments: {
    gcashNumber: string;
    gcashName: string;
    mayaNumber: string;
    mayaName: string;
    codEnabled: boolean;
  };
}

function stepFrom(settings: TenantSettingsJson | null | undefined, linkCount: number): OnboardingStep {
  const ob = settings?.onboarding;
  if (ob?.completedAt || ob?.skippedAt || linkCount > 0) return "done";
  const last = ob?.step ?? 1;
  if (last >= 3) return "link";
  if (last >= 2) return "payments";
  return "product";
}

async function counts(tenantId: string): Promise<{ links: number }> {
  const db = getDb();
  const [row] = await db.select({ n: count() }).from(checkoutLinks).where(eq(checkoutLinks.tenantId, tenantId));
  return { links: Number(row?.n ?? 0) };
}

/** True while a seller hasn't finished (or skipped) the 4 steps and has no checkout link yet. */
export async function needsOnboarding(tenantId: string): Promise<boolean> {
  const db = getDb();
  const [tenant] = await db
    .select({ settingsJson: tenants.settingsJson })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) return false;
  const { links } = await counts(tenantId);
  return stepFrom(tenant.settingsJson as TenantSettingsJson | null, links) !== "done";
}

export async function getOnboardingState(tenantId: string): Promise<OnboardingState | null> {
  const db = getDb();
  const [tenant] = await db
    .select({
      name: tenants.name,
      slug: tenants.slug,
      settingsJson: tenants.settingsJson,
      checkoutPublishedJson: tenants.checkoutPublishedJson,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) return null;
  const settings = (tenant.settingsJson ?? {}) as TenantSettingsJson;
  const { links } = await counts(tenantId);

  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      price: products.basePrice,
      imageUrl: productVariants.imageUrl,
      stockQty: productVariants.stockQty,
    })
    .from(products)
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .where(and(eq(products.tenantId, tenantId), eq(products.status, "active")))
    .orderBy(desc(products.createdAt))
    .limit(30);
  const seen = new Set<string>();
  const productList = rows
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => ({ id: r.id, title: r.title, price: r.price, imageUrl: r.imageUrl, stockQty: r.stockQty ?? 0 }));

  const checkout = tenant.checkoutPublishedJson
    ? normalizeCheckoutJson(tenant.checkoutPublishedJson)
    : checkoutFromLegacySettings(settings);
  const receiving = settings.payments?.receiving ?? {};

  return {
    step: stepFrom(settings, links),
    shop: { name: tenant.name, slug: tenant.slug },
    sellChannels: settings.social?.sellChannels ?? [],
    chatUrl: settings.social?.chatUrl ?? null,
    products: productList,
    payments: {
      gcashNumber: receiving.gcashNumber ?? "",
      gcashName: receiving.gcashName ?? "",
      mayaNumber: receiving.mayaNumber ?? "",
      mayaName: receiving.mayaName ?? "",
      codEnabled: checkout.codEnabled !== false && checkout.paymentAdapters?.cod !== false,
    },
  };
}

export async function markOnboardingStep(tenantId: string, step: 2 | 3 | 4): Promise<void> {
  const db = getDb();
  // Never move backwards (e.g. a second tab finishing an earlier step).
  await db
    .update(tenants)
    .set({
      settingsJson: sql`jsonb_set(
        coalesce(${tenants.settingsJson}, '{}'::jsonb),
        '{onboarding}',
        coalesce(${tenants.settingsJson} -> 'onboarding', '{}'::jsonb)
          || jsonb_build_object('step', greatest(coalesce((${tenants.settingsJson} -> 'onboarding' ->> 'step')::int, 1), ${step}::int))
      )`,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
}

export async function finishOnboarding(tenantId: string, how: "completed" | "skipped"): Promise<void> {
  const db = getDb();
  const key = how === "completed" ? "completedAt" : "skippedAt";
  await db
    .update(tenants)
    .set({
      settingsJson: sql`jsonb_set(
        coalesce(${tenants.settingsJson}, '{}'::jsonb),
        '{onboarding}',
        coalesce(${tenants.settingsJson} -> 'onboarding', '{}'::jsonb)
          || jsonb_build_object(${key}::text, ${new Date().toISOString()}::text)
      )`,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
}

export interface OnboardingPaymentsInput {
  gcashNumber?: string | null;
  gcashName?: string | null;
  mayaNumber?: string | null;
  mayaName?: string | null;
  codEnabled: boolean;
}

export class OnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingError";
  }
}

/**
 * Step 3. Saves where buyers send money and turns each method on only when it can
 * actually be used: GCash / Maya need a number, COD is the seller's choice.
 * Written to the published (and draft) checkout so the buyer page and storefront agree.
 */
export async function saveOnboardingPayments(tenantId: string, input: OnboardingPaymentsInput): Promise<void> {
  const gcash = input.gcashNumber ? normalizePhMobile(input.gcashNumber) : null;
  const maya = input.mayaNumber ? normalizePhMobile(input.mayaNumber) : null;
  if (input.gcashNumber?.trim() && !gcash) throw new OnboardingError("Check your GCash number (e.g. 0917 123 4567).");
  if (input.mayaNumber?.trim() && !maya) throw new OnboardingError("Check your Maya number (e.g. 0917 123 4567).");
  if (!gcash && !maya && !input.codEnabled) {
    throw new OnboardingError("Add a GCash or Maya number, or turn on cash on delivery.");
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    const [tenant] = await tx
      .select({
        settingsJson: tenants.settingsJson,
        checkoutPublishedJson: tenants.checkoutPublishedJson,
        checkoutDraftJson: tenants.checkoutDraftJson,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .for("update")
      .limit(1);
    if (!tenant) throw new OnboardingError("Shop not found.");
    const settings = (tenant.settingsJson ?? {}) as TenantSettingsJson;

    const base = tenant.checkoutPublishedJson
      ? normalizeCheckoutJson(tenant.checkoutPublishedJson)
      : checkoutFromLegacySettings(settings);
    const adapters = base.paymentAdapters ?? {};
    const checkout = normalizeCheckoutJson({
      ...base,
      // A brand-new shop gets no minimum order (the old default was ₱99, which
      // blocks a first ₱50 link). Shops that already set one keep it.
      ...(tenant.checkoutPublishedJson ? {} : { minOrderAmount: 0 }),
      codEnabled: input.codEnabled,
      paymentAdapters: {
        ...adapters,
        cod: input.codEnabled,
        manual_ewallet: { ...(adapters.manual_ewallet ?? {}), gcash: Boolean(gcash), maya: Boolean(maya) },
      },
    });

    const nextSettings: TenantSettingsJson = {
      ...settings,
      codEnabled: input.codEnabled,
      payments: {
        ...(settings.payments ?? {}),
        receiving: {
          ...(settings.payments?.receiving ?? {}),
          gcashNumber: gcash ?? "",
          gcashName: gcash ? (input.gcashName ?? "").trim().slice(0, 80) : "",
          mayaNumber: maya ?? "",
          mayaName: maya ? (input.mayaName ?? "").trim().slice(0, 80) : "",
        },
      },
      onboarding: { ...(settings.onboarding ?? {}), step: Math.max(settings.onboarding?.step ?? 1, 3) },
    };

    await tx
      .update(tenants)
      .set({
        settingsJson: nextSettings,
        checkoutPublishedJson: checkout,
        checkoutDraftJson: checkout,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));
  });
}
