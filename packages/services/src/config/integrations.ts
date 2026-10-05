import {
  allowIntegrationMocks,
  getRuntimeMode,
  isProductionRuntime,
  type RuntimeMode,
} from "./runtime-mode";

export {
  allowIntegrationMocks,
  getRuntimeMode,
  isProductionRuntime,
  type RuntimeMode,
} from "./runtime-mode";

export type IntegrationId =
  | "paymongo"
  | "paymongo_webhook"
  | "lalamove"
  | "grab"
  | "bayango"
  | "semaphore"
  | "google_oauth"
  | "ai"
  | "web_push"
  | "email"
  | "sentry"
  | "auth_secret"
  | "meta"
  | "shopee"
  | "lazada";

export type IntegrationSeverity = "required" | "optional";

export type IntegrationStatus = "configured" | "missing" | "placeholder" | "mock_allowed";

export interface IntegrationCheck {
  id: IntegrationId;
  label: string;
  /** required = MVP commerce loop / auth; optional = degrade without fake success */
  severity: IntegrationSeverity;
  status: IntegrationStatus;
  configured: boolean;
  /** True when this integration would use a mock path if invoked now */
  wouldMock: boolean;
  message: string;
  envVars: string[];
}

export interface IntegrationReport {
  mode: RuntimeMode;
  allowMocks: boolean;
  production: boolean;
  checks: IntegrationCheck[];
  /** Missing required integrations that would fail in production */
  blockers: IntegrationCheck[];
  /** Optional integrations that are not configured (truthful degrade OK) */
  warnings: IntegrationCheck[];
  ok: boolean;
}

export class IntegrationNotConfiguredError extends Error {
  readonly integration: IntegrationId;
  readonly statusCode = 503;

  constructor(integration: IntegrationId, message: string) {
    super(message);
    this.name = "IntegrationNotConfiguredError";
    this.integration = integration;
  }
}

function present(value: string | undefined | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

function isPayMongoPlaceholder(key: string | undefined): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  return (
    trimmed.startsWith("sk_test_xxx") ||
    trimmed === "sk_test_placeholder" ||
    trimmed === "change-me"
  );
}

function paymongoSecret(): string {
  return process.env.PAYMONGO_SECRET_KEY?.trim() ?? "";
}

function buildCheck(
  partial: Omit<IntegrationCheck, "configured" | "wouldMock"> & {
    configured: boolean;
    wouldMock?: boolean;
  }
): IntegrationCheck {
  const configured = partial.configured;
  const wouldMock = partial.wouldMock ?? (!configured && allowIntegrationMocks());
  return {
    ...partial,
    configured,
    wouldMock,
  };
}

/** Snapshot of every known external integration — never logs secret values. */
export function getIntegrationChecks(): IntegrationCheck[] {
  const mocks = allowIntegrationMocks();
  const paymongoKey = paymongoSecret();
  const paymongoConfigured = present(paymongoKey) && !isPayMongoPlaceholder(paymongoKey);
  const paymongoPlaceholder = isPayMongoPlaceholder(paymongoKey);

  const lalamoveConfigured =
    present(process.env.LALAMOVE_API_KEY) && present(process.env.LALAMOVE_API_SECRET);
  const grabConfigured =
    present(process.env.GRAB_CLIENT_ID) && present(process.env.GRAB_CLIENT_SECRET);
  const bayangoEnabled = process.env.BAYANGO_ENABLED === "true";
  const bayangoConfigured =
    present(process.env.BAYANGO_API_BASE_URL) && present(process.env.BAYANGO_API_KEY);
  const semaphoreConfigured = present(process.env.SEMAPHORE_API_KEY);
  const googleConfigured =
    present(process.env.GOOGLE_CLIENT_ID) && present(process.env.GOOGLE_CLIENT_SECRET);
  const aiConfigured =
    present(process.env.OPENAI_API_KEY) ||
    present(process.env.GEMINI_API_KEY) ||
    present(process.env.GOOGLE_AI_API_KEY) ||
    present(process.env.GROQ_API_KEY);
  const pushConfigured =
    present(process.env.VAPID_PUBLIC_KEY) && present(process.env.VAPID_PRIVATE_KEY);
  const emailConfigured = present(process.env.RESEND_API_KEY);
  const sentryConfigured = present(process.env.SENTRY_DSN);
  const webhookConfigured = present(process.env.PAYMONGO_WEBHOOK_SECRET);
  const authSecret = process.env.AUTH_SECRET?.trim() ?? "";
  const authConfigured =
    present(authSecret) &&
    authSecret.length >= 32 &&
    authSecret !== "change-me-to-a-long-random-string-at-least-32-chars";

  return [
    buildCheck({
      id: "auth_secret",
      label: "Auth secret",
      severity: "required",
      status: authConfigured ? "configured" : "missing",
      configured: authConfigured,
      wouldMock: false,
      message: authConfigured
        ? "AUTH_SECRET is set (≥32 chars)."
        : "AUTH_SECRET missing or too short — sessions are unsafe.",
      envVars: ["AUTH_SECRET"],
    }),
    buildCheck({
      id: "paymongo",
      label: "PayMongo payments",
      severity: "required",
      status: paymongoConfigured
        ? "configured"
        : paymongoPlaceholder
          ? "placeholder"
          : mocks
            ? "mock_allowed"
            : "missing",
      configured: paymongoConfigured,
      wouldMock: !paymongoConfigured && mocks,
      message: paymongoConfigured
        ? "PAYMONGO_SECRET_KEY is set."
        : paymongoPlaceholder
          ? "PAYMONGO_SECRET_KEY looks like a placeholder (sk_test_xxx)."
          : mocks
            ? "PayMongo not configured — mock intents allowed in this runtime."
            : "PayMongo not configured — online checkout must fail.",
      envVars: ["PAYMONGO_SECRET_KEY", "NEXT_PUBLIC_PAYMONGO_PUBLIC_KEY"],
    }),
    buildCheck({
      id: "paymongo_webhook",
      label: "PayMongo webhook secret",
      severity: "required",
      status: webhookConfigured ? "configured" : mocks ? "mock_allowed" : "missing",
      configured: webhookConfigured,
      wouldMock: false,
      message: webhookConfigured
        ? "PAYMONGO_WEBHOOK_SECRET is set."
        : "PAYMONGO_WEBHOOK_SECRET missing — paid webhooks are rejected (safe) but live settlement cannot complete.",
      envVars: ["PAYMONGO_WEBHOOK_SECRET"],
    }),
    buildCheck({
      id: "lalamove",
      label: "Lalamove delivery",
      severity: "optional",
      status: lalamoveConfigured ? "configured" : mocks ? "mock_allowed" : "missing",
      configured: lalamoveConfigured,
      wouldMock: !lalamoveConfigured && mocks,
      message: lalamoveConfigured
        ? "Lalamove API key + secret are set."
        : mocks
          ? "Lalamove not configured — mock quotes/bookings allowed in this runtime."
          : "Lalamove not configured — live courier quote/book must fail (flat-rate fallback OK at checkout).",
      envVars: ["LALAMOVE_API_KEY", "LALAMOVE_API_SECRET", "LALAMOVE_ENV"],
    }),
    buildCheck({
      id: "grab",
      label: "Grab Express",
      severity: "optional",
      status: grabConfigured ? "configured" : mocks ? "mock_allowed" : "missing",
      configured: grabConfigured,
      wouldMock: !grabConfigured && mocks,
      message: grabConfigured
        ? "Grab client credentials are set."
        : mocks
          ? "Grab not configured — mock quotes/bookings allowed in this runtime."
          : "Grab not configured — Grab quote/book must fail.",
      envVars: ["GRAB_CLIENT_ID", "GRAB_CLIENT_SECRET", "GRAB_ENV"],
    }),
    buildCheck({
      id: "bayango",
      label: "BayanGo delivery",
      severity: "optional",
      status: bayangoConfigured ? "configured" : mocks ? "mock_allowed" : "missing",
      configured: bayangoConfigured,
      wouldMock: bayangoEnabled && !bayangoConfigured && mocks,
      message: !bayangoEnabled
        ? "BayanGo is switched off (BAYANGO_ENABLED is not true)."
        : bayangoConfigured
          ? "BayanGo Partner API URL + key are set."
          : mocks
            ? "BayanGo enabled without API credentials — mock quotes/bookings in this runtime."
            : "BayanGo enabled but BAYANGO_API_BASE_URL / BAYANGO_API_KEY missing — it will not be offered.",
      envVars: [
        "BAYANGO_ENABLED",
        "BAYANGO_API_BASE_URL",
        "BAYANGO_API_KEY",
        "BAYANGO_WEBHOOK_SECRET",
        "BAYANGO_PREFERRED",
      ],
    }),
    buildCheck({
      id: "semaphore",
      label: "Semaphore SMS",
      severity: "optional",
      status: semaphoreConfigured ? "configured" : mocks ? "mock_allowed" : "missing",
      configured: semaphoreConfigured,
      wouldMock: !semaphoreConfigured && mocks,
      message: semaphoreConfigured
        ? "SEMAPHORE_API_KEY is set."
        : mocks
          ? "Semaphore not configured — mock SMS allowed in this runtime."
          : "Semaphore not configured — SMS must report failure (not sent).",
      envVars: ["SEMAPHORE_API_KEY", "SEMAPHORE_SENDER_NAME"],
    }),
    buildCheck({
      id: "google_oauth",
      label: "Google OAuth",
      severity: "optional",
      status: googleConfigured ? "configured" : "missing",
      configured: googleConfigured,
      wouldMock: false,
      message: googleConfigured
        ? "Google OAuth client is set."
        : "Google OAuth not configured — Google sign-in routes throw (email/password still works).",
      envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    }),
    buildCheck({
      id: "ai",
      label: "AI providers",
      severity: "optional",
      status: aiConfigured ? "configured" : mocks ? "mock_allowed" : "missing",
      configured: aiConfigured,
      wouldMock: !aiConfigured && mocks,
      message: aiConfigured
        ? "At least one LLM API key is set."
        : mocks
          ? "No LLM keys — mock AI outputs allowed in this runtime."
          : "No LLM keys — AI generation must fail (no fake catalog/copy).",
      envVars: ["GEMINI_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "GOOGLE_AI_API_KEY"],
    }),
    buildCheck({
      id: "web_push",
      label: "Web Push (VAPID)",
      severity: "optional",
      status: pushConfigured ? "configured" : "missing",
      configured: pushConfigured,
      wouldMock: false,
      message: pushConfigured
        ? "VAPID keys are set."
        : "VAPID not configured — push sends 0 (does not claim success).",
      envVars: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
    }),
    buildCheck({
      id: "email",
      label: "Transactional email (Resend)",
      severity: "optional",
      status: emailConfigured ? "configured" : mocks ? "mock_allowed" : "missing",
      configured: emailConfigured,
      wouldMock: !emailConfigured && mocks,
      message: emailConfigured
        ? "RESEND_API_KEY is set."
        : mocks
          ? "Resend not configured — labeled email mocks allowed in this runtime (sent=false, mock=true)."
          : "Resend not configured — notifications must report not sent (never fake success). Set RESEND_API_KEY + HELPDESK_NOTIFY_EMAIL for helpdesk.",
      envVars: ["RESEND_API_KEY", "EMAIL_FROM", "HELPDESK_NOTIFY_EMAIL"],
    }),
    // Phase 13 — channels (ready to hook up; optional, never fake success in production).
    ...channelChecks(mocks).map(buildCheck),
    buildCheck({
      id: "sentry",
      label: "Sentry error tracking",
      severity: "optional",
      status: sentryConfigured ? "configured" : "missing",
      configured: sentryConfigured,
      wouldMock: false,
      message: sentryConfigured
        ? "SENTRY_DSN is set — createLogger/captureError forward exceptions."
        : "SENTRY_DSN missing — errors stay in app logs only. Set on web, admin, and platform Vercel projects for production.",
      envVars: ["SENTRY_DSN"],
    }),
  ];
}

export function getIntegrationReport(): IntegrationReport {
  const mode = getRuntimeMode();
  const allowMocks = allowIntegrationMocks();
  const production = isProductionRuntime();
  const checks = getIntegrationChecks();

  const blockers = checks.filter((c) => {
    if (c.configured) return false;
    if (c.severity !== "required") return false;
    // In non-production, paymongo can mock — not a blocker for boot.
    if (!production && c.wouldMock) return false;
    // Webhook secret: blocker only in production (dev can settle via COD / mock).
    if (c.id === "paymongo_webhook" && !production) return false;
    return true;
  });

  const warnings = checks.filter(
    (c) => !c.configured && c.severity === "optional" && !c.wouldMock
  );

  return {
    mode,
    allowMocks,
    production,
    checks,
    blockers,
    warnings,
    ok: blockers.length === 0,
  };
}

/**
 * Throws when an integration cannot run for real and mocks are forbidden.
 * Call at the start of live API operations (create intent, book delivery, send SMS).
 */
export function assertIntegrationReady(
  integration: IntegrationId,
  opts?: { operation?: string }
): void {
  const check = getIntegrationChecks().find((c) => c.id === integration);
  if (!check) {
    throw new IntegrationNotConfiguredError(
      integration,
      `Unknown integration "${integration}".`
    );
  }
  if (check.configured) return;
  if (check.wouldMock) return;

  const op = opts?.operation ? ` (${opts.operation})` : "";
  throw new IntegrationNotConfiguredError(
    integration,
    `${check.label} is not configured${op}. ${check.message}`
  );
}

let loggedOnce = false;

/** Log integration posture once per process (safe for serverless cold starts). */
export function logIntegrationStatusOnce(logger?: {
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
}): void {
  if (loggedOnce) return;
  loggedOnce = true;

  const report = getIntegrationReport();
  const emit =
    logger ??
    ({
      info: (msg, ctx) => console.info("[integrations]", msg, ctx ?? ""),
      warn: (msg, ctx) => console.warn("[integrations]", msg, ctx ?? ""),
    } as const);

  emit.info("Integration runtime posture", {
    mode: report.mode,
    allowMocks: report.allowMocks,
    ok: report.ok,
    configured: report.checks.filter((c) => c.configured).map((c) => c.id),
    mockAllowed: report.checks.filter((c) => c.wouldMock).map((c) => c.id),
    missing: report.checks.filter((c) => !c.configured && !c.wouldMock).map((c) => c.id),
  });

  for (const blocker of report.blockers) {
    emit.warn(`BLOCKER: ${blocker.label}`, { id: blocker.id, message: blocker.message });
  }
  for (const warning of report.warnings) {
    emit.warn(`Missing optional: ${warning.label}`, {
      id: warning.id,
      message: warning.message,
    });
  }
}

/** Public JSON-safe health payload for /api/health/integrations */
export function integrationHealthPayload(): {
  ok: boolean;
  mode: RuntimeMode;
  allowMocks: boolean;
  production: boolean;
  integrations: Array<{
    id: IntegrationId;
    label: string;
    severity: IntegrationSeverity;
    status: IntegrationStatus;
    configured: boolean;
    wouldMock: boolean;
    message: string;
  }>;
  blockers: IntegrationId[];
  warnings: IntegrationId[];
} {
  const report = getIntegrationReport();
  return {
    ok: report.ok,
    mode: report.mode,
    allowMocks: report.allowMocks,
    production: report.production,
    integrations: report.checks.map((c) => ({
      id: c.id,
      label: c.label,
      severity: c.severity,
      status: c.status,
      configured: c.configured,
      wouldMock: c.wouldMock,
      message: c.message,
    })),
    blockers: report.blockers.map((c) => c.id),
    warnings: report.warnings.map((c) => c.id),
  };
}

function channelChecks(mocks: boolean): Array<Omit<IntegrationCheck, "wouldMock"> & { wouldMock: boolean }> {
  const has = (...keys: string[]) => keys.every((k) => Boolean(process.env[k]?.trim()));
  const entry = (id: IntegrationId, label: string, envVars: string[], need: string) => {
    const configured = has(...envVars);
    return {
      id,
      label,
      severity: "optional" as const,
      status: (configured ? "configured" : mocks ? "mock_allowed" : "missing") as IntegrationStatus,
      configured,
      wouldMock: !configured && mocks,
      message: configured
        ? `${envVars.join(" + ")} set.`
        : mocks
          ? `${label} not configured — demo connection and labeled mock sends allowed in this runtime.`
          : `${label} not configured — the shop sees "Malapit na" and nothing is sent. ${need}`,
      envVars,
    };
  };
  return [
    entry("meta", "Messenger & Instagram (Meta)", ["META_APP_ID", "META_APP_SECRET", "META_VERIFY_TOKEN"], "Needs Meta business verification + app review (pages_messaging, instagram_manage_messages)."),
    entry("shopee", "Shopee Open Platform", ["SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY"], "Needs a Shopee Open Platform partner app."),
    entry("lazada", "Lazada Open Platform", ["LAZADA_APP_KEY", "LAZADA_APP_SECRET"], "Needs a Lazada Open Platform app."),
  ];
}
