"use server";

import { revalidatePath } from "next/cache";
import {
  addSupportTicketMessage,
  createTemplateStock,
  getSupportTicketById,
  getTenantDetail,
  listShopBusinessCategories,
  listTemplateStock,
  moderateContentItem,
  reviewKycSession,
  recordTemplateIntelligenceEvent,
  setActiveLanding,
  setShopCategoryStatus,
  setTemplateStockStatus,
  setTenantPlan,
  setTenantStatus,
  setUserRole,
  setUserStatus,
  slugifyShopCategory,
  updatePlatformOpsSettings,
  updateSupportTicket,
  setTenantPaymentsMode,
  upsertShopBusinessCategory,
  writeAudit,
  addOptOut,
  removeOptOut,
  type ActiveLanding,
  type PlatformPaymentsMode,
  type ShopCategoryStatus,
  type SupportTicketPriority,
  type SupportTicketStatus,
  type TemplateStockSource,
  type TemplateStockStatus,
  type TenantStatus,
  type TriFlag,
  type UserStatus,
} from "@gumakart/db";
import { createSupportAccessGrantToken } from "@gumakart/auth";
import { curateTemplateSkins } from "@gumakart/ai";
import { notifyHelpdeskAgentReply } from "@gumakart/services";
import {
  BRAND_PALETTES,
  defaultLiveTemplateForCategory,
  deriveStockSkin,
  isShopTemplateId,
  normalizeStoreLook,
  previewImageForCategory,
  sellerFacingStockLabel,
  sellerLabelForStockKey,
} from "@gumakart/storefront-themes";
import { requireSuperAdminApi } from "@/lib/api-auth";

export type ActionResult = { ok: true } | { ok: false; error: string };

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

async function guard() {
  return requireSuperAdminApi();
}

function fail(error: unknown): ActionResult {
  const message = error instanceof Error ? error.message : "Action failed.";
  return { ok: false, error: message };
}

// ─── Tenants ─────────────────────────────────────────────────────────────────

export async function updateTenantStatusAction(
  tenantId: string,
  status: TenantStatus,
  label: string
): Promise<ActionResult> {
  try {
    const session = await guard();
    await setTenantStatus(tenantId, status);
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: `tenant_${status}`,
      entityType: "tenant",
      entityId: tenantId,
      entityLabel: label,
    });
    revalidatePath("/tenants");
    revalidatePath(`/tenants/${tenantId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function updateTenantPlanAction(
  tenantId: string,
  plan: string,
  label: string
): Promise<ActionResult> {
  try {
    const session = await guard();
    await setTenantPlan(tenantId, plan);
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "tenant_plan_changed",
      entityType: "tenant",
      entityId: tenantId,
      entityLabel: label,
      metadata: { plan },
    });
    revalidatePath("/tenants");
    revalidatePath(`/tenants/${tenantId}`);
    revalidatePath("/subscriptions");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

// ─── SMS opt-outs ─────────────────────────────────────────────────────────────

/** Support: a buyer asked (by chat/email/call) to stop texts. */
export async function addSmsOptOutAction(input: {
  phone: string;
  scope: "marketing" | "all";
}): Promise<ActionResult> {
  try {
    const session = await guard();
    const digits = input.phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) return { ok: false, error: "Enter a valid mobile number." };
    await addOptOut({ phone: input.phone, scope: input.scope, tenantId: null, source: "admin" });
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "sms_opt_out_added",
      entityType: "phone",
      entityId: null,
      entityLabel: `…${digits.slice(-4)}`,
      metadata: { scope: input.scope },
    });
    revalidatePath("/messaging");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function removeSmsOptOutAction(id: string, label: string): Promise<ActionResult> {
  try {
    const session = await guard();
    await removeOptOut(id);
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "sms_opt_out_removed",
      entityType: "phone",
      entityId: id,
      entityLabel: label,
    });
    revalidatePath("/messaging");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Activate / override checkout payments mode for one shop (PayMongo is Platform-only). */
export async function setTenantPaymentsModeAction(
  tenantId: string,
  mode: PlatformPaymentsMode | "",
  label: string
): Promise<ActionResult> {
  try {
    const session = await guard();
    const tenant = await getTenantDetail(tenantId);
    if (!tenant) return { ok: false, error: "Shop not found." };

    const next = mode === "" ? null : mode;
    await setTenantPaymentsMode(tenantId, next);

    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "tenant_payments_mode_changed",
      entityType: "tenant",
      entityId: tenantId,
      entityLabel: label,
      metadata: { mode: next ?? "inherit" },
    });
    revalidatePath(`/tenants/${tenantId}`);
    revalidatePath("/tenants");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Approve or reject a seller's submitted KYC. The only way a shop becomes verified. */
export async function reviewKycAction(input: {
  tenantId: string;
  sessionId: string;
  decision: "approve" | "reject";
  reason?: string;
  label: string;
}): Promise<ActionResult> {
  try {
    const session = await guard();
    const reviewed = await reviewKycSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      decision: input.decision,
      reason: input.reason,
    });
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: input.decision === "approve" ? "tenant_kyc_approved" : "tenant_kyc_rejected",
      entityType: "tenant",
      entityId: input.tenantId,
      entityLabel: input.label,
      metadata: {
        sessionId: reviewed.id,
        ...(input.decision === "reject" ? { reason: reviewed.rejectionReason } : {}),
      },
    });
    revalidatePath(`/tenants/${input.tenantId}`);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Open seller admin as this shop (Support access).
 * Returns a one-time URL on admin.* that sets a host-scoped support session cookie.
 */
export async function startSupportAccessAction(
  tenantId: string
): Promise<ActionResult & { url?: string }> {
  try {
    const session = await guard();
    const tenant = await getTenantDetail(tenantId);
    if (!tenant) return { ok: false, error: "Shop not found." };

    const grant = await createSupportAccessGrantToken({
      actorUserId: session.userId,
      actorEmail: session.email,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
    });

    const adminBase = (
      process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001"
    ).replace(/\/$/, "");
    const url = `${adminBase}/api/auth/support-access?token=${encodeURIComponent(grant)}`;

    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "support_access_started",
      entityType: "tenant",
      entityId: tenant.id,
      entityLabel: tenant.name,
      metadata: { tenantSlug: tenant.slug },
    });

    return { ok: true, url };
  } catch (error) {
    return fail(error);
  }
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function updateUserStatusAction(
  userId: string,
  status: UserStatus,
  label: string
): Promise<ActionResult> {
  try {
    const session = await guard();
    if (userId === session.userId) {
      return { ok: false, error: "You cannot change your own status." };
    }
    await setUserStatus(userId, status);
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: `user_${status}`,
      entityType: "user",
      entityId: userId,
      entityLabel: label,
    });
    revalidatePath("/users");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function updateUserRoleAction(
  userId: string,
  role: string,
  label: string
): Promise<ActionResult> {
  try {
    const session = await guard();
    if (userId === session.userId) {
      return { ok: false, error: "You cannot change your own role." };
    }
    await setUserRole(userId, role);
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "user_role_changed",
      entityType: "user",
      entityId: userId,
      entityLabel: label,
      metadata: { role },
    });
    revalidatePath("/users");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

// ─── Content moderation ──────────────────────────────────────────────────────

export async function moderateContentAction(
  itemId: string,
  input: { status?: "draft" | "approved" | "skipped"; flagged?: boolean; note?: string | null },
  label: string
): Promise<ActionResult> {
  try {
    const session = await guard();
    await moderateContentItem(itemId, { ...input, moderatorId: session.userId });
    const action = input.flagged
      ? "content_flagged"
      : input.status
        ? `content_${input.status}`
        : "content_moderated";
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action,
      entityType: "content",
      entityId: itemId,
      entityLabel: label,
      metadata: input as Record<string, unknown>,
    });
    revalidatePath("/moderation");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

// ─── Frontends ───────────────────────────────────────────────────────────────

export async function setActiveLandingAction(value: ActiveLanding): Promise<ActionResult> {
  try {
    const session = await guard();
    await setActiveLanding(value);
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "active_landing_changed",
      entityType: "platform_setting",
      entityLabel: value === "frontend2" ? "Guma One.ai" : "GumaKart",
      metadata: { key: "active_landing", value },
    });
    revalidatePath("/frontends");
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function updatePlatformSettingsAction(input: {
  softLaunch: TriFlag;
  freeTemplateSwitch: TriFlag;
  templateSwitchRequiresUpgrade: TriFlag;
  paymentsMode: PlatformPaymentsMode | "";
  helpdeskNotifyEmail: string;
  supportContactEmail: string;
}): Promise<ActionResult> {
  try {
    const session = await guard();
    const emailOk = (v: string) => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
    if (!emailOk(input.helpdeskNotifyEmail)) {
      return { ok: false, error: "Helpdesk notify email looks invalid." };
    }
    if (!emailOk(input.supportContactEmail)) {
      return { ok: false, error: "Support contact email looks invalid." };
    }

    const next = await updatePlatformOpsSettings({
      softLaunch: input.softLaunch,
      freeTemplateSwitch: input.freeTemplateSwitch,
      templateSwitchRequiresUpgrade: input.templateSwitchRequiresUpgrade,
      paymentsMode: input.paymentsMode,
      helpdeskNotifyEmail: input.helpdeskNotifyEmail,
      supportContactEmail: input.supportContactEmail,
    });

    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "platform_settings_updated",
      entityType: "platform_setting",
      entityLabel: "ops settings",
      metadata: {
        softLaunch: next.softLaunch,
        freeTemplateSwitch: next.freeTemplateSwitch,
        templateSwitchRequiresUpgrade: next.templateSwitchRequiresUpgrade,
        paymentsMode: next.paymentsMode || "inherit",
        helpdeskNotifyEmail: next.helpdeskNotifyEmail ? "(set)" : "(empty)",
        supportContactEmail: next.supportContactEmail ? "(set)" : "(empty)",
      },
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

// ─── Helpdesk ────────────────────────────────────────────────────────────────

export async function replySupportTicketAction(
  ticketId: string,
  body: string,
  isInternal = false
): Promise<ActionResult> {
  try {
    const session = await guard();
    const trimmed = body.trim();
    if (trimmed.length < 1) return { ok: false, error: "Message is empty." };
    await addSupportTicketMessage({
      ticketId,
      authorType: "agent",
      authorUserId: session.userId,
      authorName: session.displayName || session.email,
      body: trimmed,
      isInternal,
    });

    if (!isInternal) {
      const ticket = await getSupportTicketById(ticketId, { includeInternal: true });
      if (ticket?.requesterEmail) {
        const notify = await notifyHelpdeskAgentReply({
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          requesterEmail: ticket.requesterEmail,
          agentName: session.displayName || session.email,
          body: trimmed,
        });
        if (!notify.sent) {
          console.warn("[helpdesk] Agent reply email not delivered", {
            ticketNumber: ticket.ticketNumber,
            mock: notify.mock ?? false,
            error: notify.error,
          });
        }
      }
    }

    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: isInternal ? "support_internal_note" : "support_reply",
      entityType: "support_ticket",
      entityId: ticketId,
    });
    revalidatePath("/helpdesk");
    revalidatePath(`/helpdesk/${ticketId}`);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function updateSupportTicketAction(
  ticketId: string,
  patch: {
    status?: SupportTicketStatus;
    priority?: SupportTicketPriority;
    assignToMe?: boolean;
  }
): Promise<ActionResult> {
  try {
    const session = await guard();
    await updateSupportTicket(ticketId, {
      status: patch.status,
      priority: patch.priority,
      assigneeId: patch.assignToMe ? session.userId : undefined,
    });
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "support_ticket_updated",
      entityType: "support_ticket",
      entityId: ticketId,
      metadata: patch as Record<string, unknown>,
    });
    revalidatePath("/helpdesk");
    revalidatePath(`/helpdesk/${ticketId}`);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

// ─── Template Intelligence ───────────────────────────────────────────────────

export async function upsertShopCategoryAction(input: {
  id?: string;
  label: string;
  parentId?: string | null;
  status?: ShopCategoryStatus;
  sortOrder?: number;
  minVariants?: number;
  targetVariants?: number;
  notes?: string | null;
}): Promise<ActionResult> {
  try {
    const session = await guard();
    const row = await upsertShopBusinessCategory(input);
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: input.id ? "shop_category_updated" : "shop_category_created",
      entityType: "shop_business_category",
      entityId: row.id,
      entityLabel: row.label,
      metadata: { parentId: row.parentId ?? null },
    });
    await recordTemplateIntelligenceEvent({
      eventType: input.id ? "category_updated" : "category_created",
      categoryLabel: row.label,
      payload: {
        minVariants: row.minVariants,
        targetVariants: row.targetVariants,
        parentId: row.parentId ?? null,
      },
    });
    revalidatePath("/templates");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function setShopCategoryStatusAction(
  id: string,
  status: ShopCategoryStatus,
  label: string
): Promise<ActionResult> {
  try {
    const session = await guard();
    await setShopCategoryStatus(id, status);
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: status === "enabled" ? "shop_category_enabled" : "shop_category_disabled",
      entityType: "shop_business_category",
      entityId: id,
      entityLabel: label,
    });
    revalidatePath("/templates");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function createTemplateStockAction(input: {
  label: string;
  categoryLabel: string;
  liveTemplateId: string;
  stockKey?: string;
  notes?: string | null;
  source?: TemplateStockSource;
  publish?: boolean;
}): Promise<ActionResult> {
  try {
    const session = await guard();
    if (!isShopTemplateId(input.liveTemplateId)) {
      return { ok: false, error: "Unknown live template id." };
    }
    const categories = await listShopBusinessCategories();
    const cat = categories.find((c) => c.label === input.categoryLabel);
    const baseKey =
      input.stockKey?.trim() ||
      `${slugifyShopCategory(input.categoryLabel)}-${slugifyShopCategory(input.label)}`;
    const stockKey = baseKey.slice(0, 80);
    const storeLook = deriveStockSkin(hashString(`stock::${stockKey}`), stockKey);
    const row = await createTemplateStock({
      stockKey,
      label: input.label.trim(),
      categoryId: cat?.id ?? null,
      categoryLabel: input.categoryLabel,
      liveTemplateId: input.liveTemplateId,
      status: input.publish ? "published" : "draft",
      source: input.source ?? "ops_manual",
      notes: input.notes ?? null,
      previewImageUrl: previewImageForCategory(input.categoryLabel),
      storeLookJson: storeLook,
      createdByUserId: session.userId,
    });
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "template_stock_created",
      entityType: "template_stock",
      entityId: row.id,
      entityLabel: row.label,
      metadata: { stockKey: row.stockKey, status: row.status },
    });
    await recordTemplateIntelligenceEvent({
      eventType: "stock_created",
      categoryLabel: row.categoryLabel,
      stockKey: row.stockKey,
      payload: { source: row.source, liveTemplateId: row.liveTemplateId },
    });
    revalidatePath("/templates");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function setTemplateStockStatusAction(
  id: string,
  status: TemplateStockStatus,
  label: string
): Promise<ActionResult> {
  try {
    const session = await guard();
    const row = await setTemplateStockStatus(id, status);
    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: `template_stock_${status}`,
      entityType: "template_stock",
      entityId: id,
      entityLabel: label,
    });
    await recordTemplateIntelligenceEvent({
      eventType: `stock_${status}`,
      categoryLabel: row.categoryLabel,
      stockKey: row.stockKey,
    });
    revalidatePath("/templates");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

async function seedVariantsForCategory(input: {
  categoryId: string;
  actorUserId: string;
  count: number;
  source: TemplateStockSource;
  publish: boolean;
}): Promise<{ created: number; label: string; liveTemplateId: string }> {
  const categories = await listShopBusinessCategories();
  const cat = categories.find((c) => c.id === input.categoryId);
  if (!cat) throw new Error("Category not found.");

  const existing = await listTemplateStock({ categoryLabel: cat.label });
  const activeKeys = new Set(
    existing.filter((e) => e.status !== "archived").map((e) => e.stockKey)
  );
  const want = Math.max(1, Math.min(10, input.count));
  const liveTemplateId = defaultLiveTemplateForCategory(cat.label);
  const slug = cat.slug || slugifyShopCategory(cat.label);
  let created = 0;

  for (let i = 1; created < want && i <= want + 20; i += 1) {
    const stockKey = `${slug}-v${String(i).padStart(2, "0")}`;
    if (activeKeys.has(stockKey)) continue;
    const storeLook = deriveStockSkin(hashString(`stock::${stockKey}`), stockKey);
    await createTemplateStock({
      stockKey,
      label: sellerLabelForStockKey(stockKey, { storeLook }),
      categoryId: cat.id,
      categoryLabel: cat.label,
      liveTemplateId,
      status: input.publish ? "published" : "draft",
      source: input.source,
      notes: `Seeded toward ${cat.minVariants}–${cat.targetVariants} variants. Review before publish.`,
      previewImageUrl: previewImageForCategory(cat.label),
      storeLookJson: storeLook,
      createdByUserId: input.actorUserId,
    });
    activeKeys.add(stockKey);
    created += 1;
  }

  return { created, label: cat.label, liveTemplateId };
}

/**
 * Deterministic gap-filler: seed draft variants toward minVariants.
 * Uses nearest live renderer + unique storeLook — no LLM spend.
 * For AI-curated drafts use generateAiStockSkinsAction.
 */
export async function seedCategoryVariantsAction(
  categoryId: string,
  options?: { count?: number; source?: TemplateStockSource; publish?: boolean }
): Promise<ActionResult & { count?: number }> {
  try {
    const session = await guard();
    const categories = await listShopBusinessCategories();
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return { ok: false, error: "Category not found." };

    const result = await seedVariantsForCategory({
      categoryId,
      actorUserId: session.userId,
      count: options?.count ?? cat.minVariants,
      source: options?.source ?? "ops_manual",
      publish: options?.publish ?? false,
    });

    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "template_stock_seeded",
      entityType: "shop_business_category",
      entityId: categoryId,
      entityLabel: result.label,
      metadata: { created: result.created, liveTemplateId: result.liveTemplateId },
    });
    await recordTemplateIntelligenceEvent({
      eventType: "stock_seeded",
      categoryLabel: result.label,
      payload: {
        created: result.created,
        liveTemplateId: result.liveTemplateId,
        source: options?.source ?? "ops_manual",
      },
    });
    revalidatePath("/templates");
    return { ok: true, count: result.created };
  } catch (error) {
    return fail(error);
  }
}

/** Seed drafts for every enabled category still under minVariants (bundle + stock). */
export async function fillCoverageGapsAction(bundleCounts: Record<string, number>): Promise<
  ActionResult & { categoriesTouched?: number; variantsCreated?: number }
> {
  try {
    const session = await guard();
    const categories = await listShopBusinessCategories({ enabledOnly: true });
    const stockCounts = new Map<string, number>();
    for (const row of await listTemplateStock({ statuses: ["published", "draft", "approved"] })) {
      stockCounts.set(row.categoryLabel, (stockCounts.get(row.categoryLabel) ?? 0) + 1);
    }

    let categoriesTouched = 0;
    let variantsCreated = 0;

    for (const cat of categories) {
      const total = (bundleCounts[cat.label] ?? 0) + (stockCounts.get(cat.label) ?? 0);
      const gap = Math.max(0, cat.minVariants - total);
      if (gap <= 0) continue;
      const result = await seedVariantsForCategory({
        categoryId: cat.id,
        actorUserId: session.userId,
        count: gap,
        source: "ops_manual",
        publish: false,
      });
      if (result.created > 0) {
        categoriesTouched += 1;
        variantsCreated += result.created;
      }
    }

    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "template_coverage_fill",
      entityType: "template_intelligence",
      metadata: { categoriesTouched, variantsCreated },
    });
    await recordTemplateIntelligenceEvent({
      eventType: "coverage_fill",
      payload: { categoriesTouched, variantsCreated },
    });
    revalidatePath("/templates");
    return { ok: true, categoriesTouched, variantsCreated };
  } catch (error) {
    return fail(error);
  }
}

/**
 * AI-curated draft skins for a category (Gemini Flash thrifty path).
 * Falls back to deterministic high-contrast skins when no LLM key is configured.
 */
export async function generateAiStockSkinsAction(
  categoryId: string,
  options?: { count?: number }
): Promise<ActionResult & { count?: number; model?: string; fallback?: boolean }> {
  try {
    const session = await guard();
    const categories = await listShopBusinessCategories();
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return { ok: false, error: "Category not found." };

    const liveTemplateId = defaultLiveTemplateForCategory(cat.label);
    if (!isShopTemplateId(liveTemplateId)) {
      return { ok: false, error: "No live renderer mapped for this category." };
    }

    const existing = await listTemplateStock({ categoryLabel: cat.label });
    const activeKeys = new Set(
      existing.filter((e) => e.status !== "archived").map((e) => e.stockKey)
    );
    const avoidLabels = existing
      .filter((e) => e.status !== "archived")
      .map((e) => e.label);

    const want = Math.max(1, Math.min(5, options?.count ?? Math.max(3, cat.minVariants)));
    const curated = await curateTemplateSkins({
      categoryLabel: cat.label,
      liveTemplateId,
      count: want,
      avoidLabels,
    });

    const slug = cat.slug || slugifyShopCategory(cat.label);
    let created = 0;

    for (let i = 0; i < curated.skins.length; i += 1) {
      const draft = curated.skins[i]!;
      let stockKey = `${slug}-ai-${String(i + 1).padStart(2, "0")}`;
      let n = i + 1;
      while (activeKeys.has(stockKey) && n < i + 30) {
        n += 1;
        stockKey = `${slug}-ai-${String(n).padStart(2, "0")}`;
      }
      if (activeKeys.has(stockKey)) continue;

      const palette =
        BRAND_PALETTES.find((p) => p.id === draft.paletteId) ??
        BRAND_PALETTES[i % BRAND_PALETTES.length]!;
      const look = normalizeStoreLook(draft);
      const base = deriveStockSkin(hashString(`stock::${stockKey}`), stockKey);
      const storeLook = {
        ...base,
        ...look,
        primaryColor: palette.primary,
        accentColor: palette.accent,
        paletteId: palette.id,
        displayFont: draft.displayFont ?? base.displayFont,
        radius: draft.radius ?? base.radius,
      };

      await createTemplateStock({
        stockKey,
        label: sellerFacingStockLabel({
          label: draft.label,
          stockKey,
          storeLookJson: storeLook,
        }),
        categoryId: cat.id,
        categoryLabel: cat.label,
        liveTemplateId,
        status: "draft",
        source: "ai_curated",
        notes:
          draft.notes ??
          `AI curated via ${curated.model}${curated.fallback ? " (fallback)" : ""}. Preview before publish.`,
        previewImageUrl: previewImageForCategory(cat.label),
        storeLookJson: storeLook,
        createdByUserId: session.userId,
      });
      activeKeys.add(stockKey);
      created += 1;
    }

    await writeAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "template_stock_ai_curated",
      entityType: "shop_business_category",
      entityId: categoryId,
      entityLabel: cat.label,
      metadata: {
        created,
        model: curated.model,
        provider: curated.provider,
        fallback: curated.fallback,
        liveTemplateId,
      },
    });
    await recordTemplateIntelligenceEvent({
      eventType: "stock_ai_curated",
      categoryLabel: cat.label,
      payload: {
        created,
        model: curated.model,
        provider: curated.provider,
        fallback: curated.fallback,
        liveTemplateId,
      },
    });
    revalidatePath("/templates");
    return {
      ok: true,
      count: created,
      model: curated.model,
      fallback: curated.fallback,
    };
  } catch (error) {
    return fail(error);
  }
}

// ─── Phase 16: system health & status page ────────────────────────────────────

export async function resolveAppErrorAction(id: string): Promise<ActionResult> {
  try {
    const session = await guard();
    const { resolveAppError } = await import("@gumakart/db");
    if (!(await resolveAppError(id))) return { ok: false, error: "That error is gone." };
    await writeAudit({ actorId: session.userId, actorEmail: session.email, action: "app_error_resolved", entityType: "app_error", entityId: id, entityLabel: id.slice(0, 8) });
    revalidatePath("/system");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function createIncidentAction(input: {
  title: string;
  impact: "minor" | "major" | "maintenance";
  components: string[];
  message: string;
}): Promise<ActionResult> {
  try {
    const session = await guard();
    const { createIncident } = await import("@gumakart/db");
    const id = await createIncident({ ...input, createdBy: session.email ?? "ops" });
    await writeAudit({ actorId: session.userId, actorEmail: session.email, action: "status_incident_created", entityType: "status_incident", entityId: id, entityLabel: input.title.slice(0, 80) });
    revalidatePath("/status-page");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function addIncidentUpdateAction(
  id: string,
  input: { status: "investigating" | "identified" | "monitoring" | "resolved"; message: string }
): Promise<ActionResult> {
  try {
    const session = await guard();
    const { addIncidentUpdate } = await import("@gumakart/db");
    await addIncidentUpdate(id, input);
    await writeAudit({ actorId: session.userId, actorEmail: session.email, action: `status_incident_${input.status}`, entityType: "status_incident", entityId: id, entityLabel: input.message.slice(0, 80) });
    revalidatePath("/status-page");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
