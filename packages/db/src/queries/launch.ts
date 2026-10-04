import { needsOnboarding } from "./onboarding";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import { tenants } from "../schema/index";

export type ThemeJson = {
  templateId?: string;
  patternId?: string;
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  displayFont?: "bricolage" | "system" | "mono-accent";
  paletteId?: string;
  vibe?: string;
  tagline?: string;
  promoTitle?: string;
  promoSubtitle?: string;
  storeLook?: {
    heroLayout?: "circle" | "split" | "stack";
    marquee?: "on" | "off";
    floatCards?: "on" | "off";
    menuColumns?: "2" | "3";
    typeScale?: "classic" | "bold" | "soft";
    radiusTone?: "soft" | "sharp";
  };
  /** Free Bundle curated pick — may differ from live templateId. */
  catalogId?: string;
  catalogLabel?: string;
};

export type StoreDnaJson = NonNullable<(typeof tenants.$inferSelect)["storeDnaJson"]>;

export interface LaunchTenantState {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  status: string;
  subscriptionPlan: string | null;
  storeDnaJson: StoreDnaJson | null;
  themeJson: ThemeJson | null;
  themeDraftJson: ThemeJson | null;
  themePublishedJson: ThemeJson | null;
  customizationVersion: number;
  coverUrl: string | null;
  logoUrl: string | null;
}

export async function getLaunchTenantState(tenantId: string): Promise<LaunchTenantState | null> {
  const db = getDb();
  const [tenant] = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      category: tenants.category,
      status: tenants.status,
      subscriptionPlan: tenants.subscriptionPlan,
      storeDnaJson: tenants.storeDnaJson,
      themeJson: tenants.themeJson,
      themeDraftJson: tenants.themeDraftJson,
      themePublishedJson: tenants.themePublishedJson,
      customizationVersion: tenants.customizationVersion,
      coverUrl: tenants.coverUrl,
      logoUrl: tenants.logoUrl,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) return null;

  return {
    ...tenant,
    themeJson: tenant.themeJson as ThemeJson | null,
    themeDraftJson: tenant.themeDraftJson as ThemeJson | null,
    themePublishedJson: tenant.themePublishedJson as ThemeJson | null,
  };
}

export async function updateStoreDna(
  tenantId: string,
  storeDnaJson: StoreDnaJson
): Promise<LaunchTenantState | null> {
  const db = getDb();
  await db
    .update(tenants)
    .set({
      storeDnaJson,
      category: storeDnaJson.category,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
  return getLaunchTenantState(tenantId);
}

export async function saveThemeDraft(
  tenantId: string,
  draft: ThemeJson
): Promise<LaunchTenantState | null> {
  const db = getDb();
  await db
    .update(tenants)
    .set({
      themeDraftJson: draft as typeof tenants.$inferSelect.themeDraftJson,
      // Keep legacy themeJson in sync as working copy during Launch (not published yet)
      themeJson: draft as typeof tenants.$inferSelect.themeJson,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
  return getLaunchTenantState(tenantId);
}

/**
 * Merchant-approved publish: draft → published.
 * Bumps customization_version for rollback/audit.
 */
export async function publishThemeDraft(tenantId: string): Promise<LaunchTenantState | null> {
  const db = getDb();
  const state = await getLaunchTenantState(tenantId);
  if (!state) return null;

  const draft = state.themeDraftJson ?? state.themeJson;
  if (!draft?.templateId) {
    throw new Error("Nothing to publish — choose a template and personalize first.");
  }

  const nextDna: StoreDnaJson = {
    ...(state.storeDnaJson ?? {
      version: 1 as const,
      businessName: state.name,
      category: state.category ?? "General",
      vibe: "fresh",
      locale: "taglish" as const,
      derivedAt: new Date().toISOString(),
    }),
    selectedTemplateId: draft.templateId,
    launchStep: "done",
  };

  await db
    .update(tenants)
    .set({
      themeDraftJson: draft as typeof tenants.$inferSelect.themeDraftJson,
      themePublishedJson: draft as typeof tenants.$inferSelect.themePublishedJson,
      themeJson: draft as typeof tenants.$inferSelect.themeJson,
      storeDnaJson: nextDna,
      customizationVersion: sql`${tenants.customizationVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  return getLaunchTenantState(tenantId);
}

/** Effective theme for buyer storefront */
export function resolvePublishedThemeJson(tenant: {
  themePublishedJson?: ThemeJson | null;
  themeJson?: ThemeJson | null;
}): ThemeJson | null {
  return tenant.themePublishedJson ?? tenant.themeJson ?? null;
}

/**
 * True when the seller should stay in GUMA Launch (not the old Shop Builder dashboard).
 * Legacy shops that already picked a template via Shop Builder are left alone.
 */
export function needsGumaLaunch(tenant: {
  storeDnaJson?: StoreDnaJson | null;
  themePublishedJson?: ThemeJson | null;
  themeJson?: ThemeJson | null;
} | null | undefined): boolean {
  if (!tenant) return true;
  if (tenant.themePublishedJson?.templateId) return false;

  const launchStep = tenant.storeDnaJson?.launchStep;
  if (launchStep === "done") return false;
  if (launchStep) return true;

  // Never customized (or only seeded brand kit without a concrete template pick)
  if (!tenant.themeJson?.templateId) return true;
  return false;
}

/**
 * Post-auth / post-login home for sellers. Plan §9: the 4-step onboarding (ending
 * in a shareable checkout link) comes first; the Launch wizard (online store look)
 * is optional and no longer forced.
 */
export async function resolveSellerHomePath(input: {
  tenantId: string | null | undefined;
  emailVerified?: boolean;
  preferLaunchWhenUnverified?: boolean;
}): Promise<string> {
  if (!input.tenantId) return "/signup/shop";
  if (await needsOnboarding(input.tenantId)) return "/onboarding";
  return "/";
}

/**
 * Recent published (or draft) template picks in a category — used for soft
 * anti-collision so Launch Top-3 spreads across similar shops.
 */
export async function listRecentTemplateIdsByCategory(
  category: string | null | undefined,
  options?: { limit?: number; excludeTenantId?: string }
): Promise<string[]> {
  const cat = category?.trim();
  if (!cat) return [];

  const db = getDb();
  const limit = options?.limit ?? 12;
  const rows = await db
    .select({
      id: tenants.id,
      themePublishedJson: tenants.themePublishedJson,
      themeDraftJson: tenants.themeDraftJson,
      themeJson: tenants.themeJson,
    })
    .from(tenants)
    .where(eq(tenants.category, cat))
    .orderBy(sql`${tenants.createdAt} desc`)
    .limit(limit + 4);

  const ids: string[] = [];
  for (const row of rows) {
    if (options?.excludeTenantId && row.id === options.excludeTenantId) continue;
    const theme =
      (row.themePublishedJson as ThemeJson | null) ??
      (row.themeDraftJson as ThemeJson | null) ??
      (row.themeJson as ThemeJson | null);
    const templateId = theme?.templateId?.trim();
    if (templateId) ids.push(templateId);
    if (ids.length >= limit) break;
  }
  return ids;
}
