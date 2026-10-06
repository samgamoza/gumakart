import { getPlatformOpsSettings } from "@gumakart/db";
import { getTwoFactorStatus } from "@gumakart/auth";
import { getIntegrationReport } from "@gumakart/services";
import { requireSuperAdmin } from "@/lib/session";
import { PlatformShell } from "@/components/platform-shell";
import { SettingsPanel } from "@/components/settings-panel";
import { OpsSecurityCard } from "@/components/ops-security-card";

export const dynamic = "force-dynamic";

function keyConfigured(...keys: string[]): boolean {
  return keys.some((k) => {
    const v = process.env[k]?.trim() ?? "";
    return Boolean(v) && !v.startsWith("xxx") && v !== "change-me";
  });
}

export default async function SettingsPage() {
  const session = await requireSuperAdmin();
  const ops = await getPlatformOpsSettings();
  const report = getIntegrationReport();
  const twoFactor = await getTwoFactorStatus(session.userId);

  const publicUrls = {
    storefront:
      process.env.NEXT_PUBLIC_STOREFRONT_URL ??
      process.env.NEXT_PUBLIC_WEB_URL ??
      "http://localhost:3010",
    admin: process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001",
    platform: process.env.NEXT_PUBLIC_PLATFORM_URL ?? "http://localhost:3002",
  };

  const providerKeys = [
    {
      key: "GEMINI_API_KEY",
      label: "Gemini",
      configured: keyConfigured("GEMINI_API_KEY", "GOOGLE_AI_API_KEY"),
      detail: "Template Intel thrifty model",
    },
    {
      key: "OPENAI_API_KEY",
      label: "OpenAI",
      configured: keyConfigured("OPENAI_API_KEY"),
    },
    {
      key: "GROQ_API_KEY",
      label: "Groq",
      configured: keyConfigured("GROQ_API_KEY"),
    },
    {
      key: "RESEND_API_KEY",
      label: "Resend (email)",
      configured: keyConfigured("RESEND_API_KEY"),
    },
    {
      key: "PAYMONGO_SECRET_KEY",
      label: "PayMongo",
      configured: keyConfigured("PAYMONGO_SECRET_KEY"),
    },
  ];

  return (
    <PlatformShell
      title="Settings"
      subtitle="Soft-launch flags, payments mode, support contacts, and provider status"
      user={{ displayName: session.displayName, email: session.email }}
    >
      <div className="mb-6">
        <OpsSecurityCard enabledAt={twoFactor.enabledAt?.toISOString() ?? null} backupCodesLeft={twoFactor.backupCodesLeft} />
      </div>
      <SettingsPanel
        initial={ops}
        envFlags={{
          softLaunch: process.env.GUMA_SOFT_LAUNCH === "true",
          freeTemplateSwitch: process.env.GUMA_FREE_TEMPLATE_SWITCH === "true",
          requiresUpgrade: process.env.GUMA_TEMPLATE_SWITCH_REQUIRES_UPGRADE === "true",
          paymentsMode: (process.env.PAYMENTS_MODE ?? "manual_ewallet").trim() || "manual_ewallet",
        }}
        publicUrls={publicUrls}
        providerKeys={providerKeys}
        integrations={report.checks.map((c) => ({
          id: c.id,
          label: c.label,
          status: c.status,
          message: c.message,
          severity: c.severity,
        }))}
        activeLandingLabel={
          ops.activeLanding === "frontend2" ? "Guma One.ai" : "GumaKart"
        }
      />
    </PlatformShell>
  );
}
