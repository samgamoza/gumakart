import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { tenants } from "../schema/index";
import type {
  TenantSettingsJson,
  TenantSettingsRecord,
  TenantWalletSettings,
  UpdateTenantSettingsInput,
} from "../types/tenant-settings";

/**
 * KYC result fields are written only by `setTenantKycFlags` (platform review).
 * A seller-facing settings patch must never be able to mark itself verified.
 */
function stripKycFields(
  wallet: Partial<TenantWalletSettings> | undefined
): Partial<TenantWalletSettings> | undefined {
  if (!wallet) return wallet;
  const { kycVerified: _v, kycStatus: _s, kycVerifiedAt: _a, ...rest } = wallet;
  return rest;
}

function mergeSettings(
  current: TenantSettingsJson | null | undefined,
  rawPatch: UpdateTenantSettingsInput["settings"]
): TenantSettingsJson {
  if (!rawPatch) return current ?? {};
  const patch = rawPatch.wallet ? { ...rawPatch, wallet: stripKycFields(rawPatch.wallet) } : rawPatch;

  return {
    ...current,
    ...patch,
    delivery: patch.delivery ? { ...current?.delivery, ...patch.delivery } : current?.delivery,
    notifications: patch.notifications
      ? { ...current?.notifications, ...patch.notifications }
      : current?.notifications,
    whatsapp: patch.whatsapp ? { ...current?.whatsapp, ...patch.whatsapp } : current?.whatsapp,
    tracking: patch.tracking ? { ...current?.tracking, ...patch.tracking } : current?.tracking,
    shopAssistant: patch.shopAssistant
      ? { ...current?.shopAssistant, ...patch.shopAssistant }
      : current?.shopAssistant,
    agents: patch.agents ? { ...current?.agents, ...patch.agents } : current?.agents,
    wallet: patch.wallet ? { ...current?.wallet, ...patch.wallet } : current?.wallet,
    checkout: patch.checkout ? { ...current?.checkout, ...patch.checkout } : current?.checkout,
    contact: patch.contact ? { ...current?.contact, ...patch.contact } : current?.contact,
    social: patch.social ? { ...current?.social, ...patch.social } : current?.social,
    automations: patch.automations ? { ...current?.automations, ...patch.automations } : current?.automations,
    payments: patch.payments
      ? {
          ...current?.payments,
          ...patch.payments,
          receiving: patch.payments.receiving
            ? { ...current?.payments?.receiving, ...patch.payments.receiving }
            : current?.payments?.receiving,
        }
      : current?.payments,
  };
}

export async function getTenantSettings(tenantId: string): Promise<TenantSettingsRecord | null> {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return null;

  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    legalName: tenant.legalName,
    category: tenant.category,
    localeDefault: tenant.localeDefault,
    currency: tenant.currency,
    timezone: tenant.timezone,
    subscriptionPlan: tenant.subscriptionPlan,
    status: tenant.status,
    themeJson: tenant.themeJson,
    settings: tenant.settingsJson ?? {},
  };
}

/**
 * Platform-only: set or clear this shop's checkout payments mode.
 * `null` removes the override so the shop inherits platform Settings / env.
 */
export async function setTenantPaymentsMode(
  tenantId: string,
  mode: "manual_ewallet" | "paymongo" | "both" | null
): Promise<TenantSettingsRecord | null> {
  const db = getDb();
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!existing) return null;

  const current = (existing.settingsJson ?? {}) as TenantSettingsJson;
  const payments = { ...(current.payments ?? {}) };
  if (mode === null) {
    delete payments.mode;
  } else {
    payments.mode = mode;
  }
  const nextSettings: TenantSettingsJson = {
    ...current,
    payments: Object.keys(payments).length > 0 ? payments : undefined,
  };

  await db
    .update(tenants)
    .set({ settingsJson: nextSettings, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  return getTenantSettings(tenantId);
}

/**
 * Platform/KYC-review only. Writes the wallet KYC flags directly, bypassing the
 * merge filter above. Not exported from the package index on purpose — call
 * `reviewKycSession` instead.
 */
export async function setTenantKycFlags(
  tenantId: string,
  flags: { kycVerified: boolean; kycStatus: NonNullable<TenantWalletSettings["kycStatus"]>; kycVerifiedAt?: string }
): Promise<void> {
  const db = getDb();
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!existing) return;
  const current = (existing.settingsJson ?? {}) as TenantSettingsJson;
  const wallet: TenantWalletSettings = { ...(current.wallet ?? {}), ...flags };
  if (!flags.kycVerified) delete wallet.kycVerifiedAt;
  const nextSettings: TenantSettingsJson = { ...current, wallet };
  await db
    .update(tenants)
    .set({ settingsJson: nextSettings, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));
}

export async function updateTenantSettings(
  tenantId: string,
  input: UpdateTenantSettingsInput
): Promise<TenantSettingsRecord | null> {
  const db = getDb();
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!existing) return null;

  const nextSettings = mergeSettings(existing.settingsJson, input.settings);

  if (input.settings?.whatsapp?.enabled === true) {
    const currentWhatsapp = nextSettings.whatsapp ?? {};
    if (!currentWhatsapp.connectedAt) {
      nextSettings.whatsapp = {
        ...currentWhatsapp,
        connectedAt: new Date().toISOString(),
      };
    }
  }

  if (input.settings?.whatsapp?.enabled === false) {
    nextSettings.whatsapp = {
      ...nextSettings.whatsapp,
      enabled: false,
    };
  }

  const currentTheme = existing.themeJson ?? {};
  const nextTheme = {
    ...currentTheme,
    ...(input.tagline !== undefined ? { tagline: input.tagline } : {}),
    ...(input.promoTitle !== undefined ? { promoTitle: input.promoTitle } : {}),
    ...(input.promoSubtitle !== undefined ? { promoSubtitle: input.promoSubtitle } : {}),
  };

  await db
    .update(tenants)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.localeDefault !== undefined ? { localeDefault: input.localeDefault } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.subscriptionPlan !== undefined ? { subscriptionPlan: input.subscriptionPlan } : {}),
      themeJson: nextTheme,
      settingsJson: nextSettings,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  return getTenantSettings(tenantId);
}

export type {
  TenantSettingsJson,
  TenantSettingsRecord,
  UpdateTenantSettingsInput,
} from "../types/tenant-settings";
