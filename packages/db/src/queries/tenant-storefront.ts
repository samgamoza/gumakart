import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { tenants } from "../schema/index";

export interface TenantStorefrontSettings {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  subscriptionPlan: string | null;
  themeJson: {
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
  } | null;
  themeDraftJson?: TenantStorefrontSettings["themeJson"];
  themePublishedJson?: TenantStorefrontSettings["themeJson"];
  customizationVersion?: number;
  storeDnaJson?: unknown;
}

export interface UpdateTenantStorefrontInput {
  templateId?: string;
  patternId?: "classic" | "simply-sweet" | "bloom" | "sarab" | "furnish" | "zay" | "electro" | "kaira" | "foodmart" | "stylish" | "mellow" | "organic" | "waggy" | "fruitables" | "ministore" | "aircon" | "carserv" | "motto" | "studio" | "haircut" | "specialty" | "palenke";
  primaryColor?: string;
  accentColor?: string;
  displayFont?: "bricolage" | "system" | "mono-accent";
  paletteId?: string;
  tagline?: string;
  promoTitle?: string;
  promoSubtitle?: string;
  coverUrl?: string | null;
  logoUrl?: string | null;
}

export async function getTenantStorefrontSettings(
  tenantId: string
): Promise<TenantStorefrontSettings | null> {
  const db = getDb();
  const [tenant] = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      category: tenants.category,
      logoUrl: tenants.logoUrl,
      coverUrl: tenants.coverUrl,
      subscriptionPlan: tenants.subscriptionPlan,
      themeJson: tenants.themeJson,
      themeDraftJson: tenants.themeDraftJson,
      themePublishedJson: tenants.themePublishedJson,
      customizationVersion: tenants.customizationVersion,
      storeDnaJson: tenants.storeDnaJson,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  return tenant ?? null;
}

export async function updateTenantStorefront(
  tenantId: string,
  input: UpdateTenantStorefrontInput
): Promise<TenantStorefrontSettings | null> {
  const db = getDb();
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!existing) return null;

  // Appearance / Shop Builder edits go to draft (Constitution: Draft → Approve → Publish)
  const currentDraft = existing.themeDraftJson ?? existing.themeJson ?? {};
  const nextDraft = {
    ...currentDraft,
    ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
    ...(input.patternId !== undefined ? { patternId: input.patternId } : {}),
    ...(input.primaryColor !== undefined ? { primaryColor: input.primaryColor } : {}),
    ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
    ...(input.displayFont !== undefined ? { displayFont: input.displayFont } : {}),
    ...(input.paletteId !== undefined ? { paletteId: input.paletteId } : {}),
    ...(input.tagline !== undefined ? { tagline: input.tagline } : {}),
    ...(input.promoTitle !== undefined ? { promoTitle: input.promoTitle } : {}),
    ...(input.promoSubtitle !== undefined ? { promoSubtitle: input.promoSubtitle } : {}),
  };

  await db
    .update(tenants)
    .set({
      themeDraftJson: nextDraft as typeof existing.themeDraftJson,
      themeJson: nextDraft as typeof existing.themeJson,
      ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl } : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  return getTenantStorefrontSettings(tenantId);
}
