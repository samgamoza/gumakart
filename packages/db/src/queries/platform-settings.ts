import { eq, inArray } from "drizzle-orm";
import { getDb } from "../client";
import { platformSettings } from "../schema/index";

/** Which marketing landing the public "/" route renders. */
export type ActiveLanding = "frontend1" | "frontend2" | "frontend3";

/** Every public homepage the ops console can make live, with its display name. */
export const ACTIVE_LANDINGS: Record<ActiveLanding, string> = {
  frontend1: "GumaKart",
  frontend2: "Guma One.ai",
  frontend3: "Palenke AI",
};

export function parseActiveLanding(value: string | null | undefined): ActiveLanding {
  return value && value in ACTIVE_LANDINGS ? (value as ActiveLanding) : "frontend1";
}
export const ACTIVE_LANDING_KEY = "active_landing";

/** Ops console Settings — stored in platform_settings (env remains fallback). */
export const SOFT_LAUNCH_KEY = "soft_launch";
export const FREE_TEMPLATE_SWITCH_KEY = "free_template_switch";
export const TEMPLATE_SWITCH_REQUIRES_UPGRADE_KEY = "template_switch_requires_upgrade";
export const PAYMENTS_MODE_KEY = "payments_mode";
export const HELPDESK_NOTIFY_EMAIL_KEY = "helpdesk_notify_email";
export const SUPPORT_CONTACT_EMAIL_KEY = "support_contact_email";

export type TriFlag = "inherit" | "true" | "false";
export type PlatformPaymentsMode = "manual_ewallet" | "paymongo" | "both";

export type PlatformOpsSettings = {
  softLaunch: TriFlag;
  freeTemplateSwitch: TriFlag;
  templateSwitchRequiresUpgrade: TriFlag;
  /** Empty string = inherit PAYMENTS_MODE env. */
  paymentsMode: PlatformPaymentsMode | "";
  helpdeskNotifyEmail: string;
  supportContactEmail: string;
  activeLanding: ActiveLanding;
};

const OPS_KEYS = [
  SOFT_LAUNCH_KEY,
  FREE_TEMPLATE_SWITCH_KEY,
  TEMPLATE_SWITCH_REQUIRES_UPGRADE_KEY,
  PAYMENTS_MODE_KEY,
  HELPDESK_NOTIFY_EMAIL_KEY,
  SUPPORT_CONTACT_EMAIL_KEY,
  ACTIVE_LANDING_KEY,
] as const;

export async function getPlatformSetting(key: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setPlatformSetting(key: string, value: string): Promise<void> {
  const db = getDb();
  await db
    .insert(platformSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
}

/** Active landing, defaulting to frontend1 (GumaKart) when unset. */
export async function getActiveLanding(): Promise<ActiveLanding> {
  const value = await getPlatformSetting(ACTIVE_LANDING_KEY);
  return parseActiveLanding(value);
}

export async function setActiveLanding(value: ActiveLanding): Promise<void> {
  if (!(value in ACTIVE_LANDINGS)) throw new Error(`Unknown landing: ${String(value)}`);
  await setPlatformSetting(ACTIVE_LANDING_KEY, value);
}

export function parseTriFlag(value: string | null | undefined): TriFlag {
  if (value === "true") return "true";
  if (value === "false") return "false";
  return "inherit";
}

/** null = inherit env; true/false = force. */
export function triFlagToBoolOverride(flag: TriFlag): boolean | null {
  if (flag === "true") return true;
  if (flag === "false") return false;
  return null;
}

function parsePaymentsMode(value: string | null | undefined): PlatformPaymentsMode | "" {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw === "paymongo" || raw === "both" || raw === "manual_ewallet") return raw;
  return "";
}

export async function getPlatformOpsSettings(): Promise<PlatformOpsSettings> {
  const db = getDb();
  const rows = await db
    .select()
    .from(platformSettings)
    .where(inArray(platformSettings.key, [...OPS_KEYS]));
  const map = new Map(rows.map((r) => [r.key, r.value]));

  return {
    softLaunch: parseTriFlag(map.get(SOFT_LAUNCH_KEY)),
    freeTemplateSwitch: parseTriFlag(map.get(FREE_TEMPLATE_SWITCH_KEY)),
    templateSwitchRequiresUpgrade: parseTriFlag(map.get(TEMPLATE_SWITCH_REQUIRES_UPGRADE_KEY)),
    paymentsMode: parsePaymentsMode(map.get(PAYMENTS_MODE_KEY)),
    helpdeskNotifyEmail: (map.get(HELPDESK_NOTIFY_EMAIL_KEY) ?? "").trim(),
    supportContactEmail: (map.get(SUPPORT_CONTACT_EMAIL_KEY) ?? "").trim(),
    activeLanding: parseActiveLanding(map.get(ACTIVE_LANDING_KEY)),
  };
}

export async function updatePlatformOpsSettings(
  patch: Partial<{
    softLaunch: TriFlag;
    freeTemplateSwitch: TriFlag;
    templateSwitchRequiresUpgrade: TriFlag;
    paymentsMode: PlatformPaymentsMode | "";
    helpdeskNotifyEmail: string;
    supportContactEmail: string;
  }>
): Promise<PlatformOpsSettings> {
  if (patch.softLaunch !== undefined) {
    await setPlatformSetting(
      SOFT_LAUNCH_KEY,
      patch.softLaunch === "inherit" ? "" : patch.softLaunch
    );
  }
  if (patch.freeTemplateSwitch !== undefined) {
    await setPlatformSetting(
      FREE_TEMPLATE_SWITCH_KEY,
      patch.freeTemplateSwitch === "inherit" ? "" : patch.freeTemplateSwitch
    );
  }
  if (patch.templateSwitchRequiresUpgrade !== undefined) {
    await setPlatformSetting(
      TEMPLATE_SWITCH_REQUIRES_UPGRADE_KEY,
      patch.templateSwitchRequiresUpgrade === "inherit"
        ? ""
        : patch.templateSwitchRequiresUpgrade
    );
  }
  if (patch.paymentsMode !== undefined) {
    await setPlatformSetting(PAYMENTS_MODE_KEY, patch.paymentsMode);
  }
  if (patch.helpdeskNotifyEmail !== undefined) {
    await setPlatformSetting(HELPDESK_NOTIFY_EMAIL_KEY, patch.helpdeskNotifyEmail.trim());
  }
  if (patch.supportContactEmail !== undefined) {
    await setPlatformSetting(SUPPORT_CONTACT_EMAIL_KEY, patch.supportContactEmail.trim());
  }
  return getPlatformOpsSettings();
}
