import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  aiMediaJobs,
  aiSuiteSettings,
  broadcastCampaigns,
  broadcastRecipients,
  orderItems,
  orders,
  printairUpsells,
  productReviews,
  reviewPrompts,
  tenants,
  type AiMediaOutput,
  type BroadcastSendMode,
  type BuyerSegmentTag,
  type PrintairMilestone,
  type SocialPlatform,
} from "../schema/index";
import { CheckoutLinkError, createCheckoutLink, type CheckoutLinkShareChannel } from "./checkout-links";
import { issueGiftCardInTx } from "./gift-cards";
import { reviewDisplayName, reviewEligibility } from "./reviews";

/**
 * AI Marketing Suite Phases 4 + 5 (migration 0050):
 *   4.1 buyer CRM segments (nightly refresh_buyer_crm_segments per shop)
 *   4.2 payday / restock broadcasts — recipients frozen at queue time with how each buyer can be
 *       reached inside Meta's rules (24 h window, or an approved WhatsApp template)
 *   4.3 BayanGo review loop — ask 2 h after delivery, publish the verified review, single-use voucher
 *   5.1 Printair branded-packaging mockups at shop milestones
 */

type Rows<T> = T[];
async function rows<T>(q: ReturnType<typeof sql>): Promise<Rows<T>> {
  return (await getDb().execute(q)) as unknown as Rows<T>;
}

export const BUYER_SEGMENT_TAGS: BuyerSegmentTag[] = ["VIP_REPEAT", "PAYDAY_SHOPPER", "INACTIVE_60D"];

// ─── 4.1 Segments ─────────────────────────────────────────────────────────────

export async function refreshBuyerSegments(tenantId: string): Promise<number> {
  const [r] = await rows<{ n: number }>(sql`select refresh_buyer_crm_segments(${tenantId}::uuid) as n`);
  return Number(r?.n ?? 0);
}

/** Active shops with at least one order in the last 400 days (the nightly job's work list). */
export async function listTenantsForSegmentRefresh(limit = 5000): Promise<string[]> {
  const r = await rows<{ id: string }>(sql`
    select t.id from tenants t
    where t.status = 'active'
      and exists (select 1 from orders o where o.tenant_id = t.id and o.created_at > now() - interval '400 days')
    order by t.id
    limit ${limit}`);
  return r.map((x) => x.id);
}

export interface SegmentCounts {
  total: number;
  tags: Record<BuyerSegmentTag, number>;
  refreshedAt: Date | null;
}

export async function getSegmentCounts(tenantId: string): Promise<SegmentCounts> {
  const [r] = await rows<{ total: number; vip: number; payday: number; inactive: number; refreshed: string | null }>(sql`
    select count(*)::int as total,
      count(*) filter (where 'VIP_REPEAT' = any(tags))::int as vip,
      count(*) filter (where 'PAYDAY_SHOPPER' = any(tags))::int as payday,
      count(*) filter (where 'INACTIVE_60D' = any(tags))::int as inactive,
      max(refreshed_at)::text as refreshed
    from buyer_crm_segments where tenant_id = ${tenantId}`);
  return {
    total: Number(r?.total ?? 0),
    tags: { VIP_REPEAT: Number(r?.vip ?? 0), PAYDAY_SHOPPER: Number(r?.payday ?? 0), INACTIVE_60D: Number(r?.inactive ?? 0) },
    refreshedAt: r?.refreshed ? new Date(r.refreshed) : null,
  };
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface AiSuiteSettingsRow {
  reviewLoopEnabled: boolean;
  reviewVoucherAmount: number;
  reviewVoucherDays: number;
  waReviewTemplate: string | null;
  waTemplateLanguage: string;
  paydayAlertDismissedFor: string | null;
}

export const DEFAULT_AI_SUITE_SETTINGS: AiSuiteSettingsRow = {
  reviewLoopEnabled: true,
  reviewVoucherAmount: 50,
  reviewVoucherDays: 30,
  waReviewTemplate: null,
  waTemplateLanguage: "en",
  paydayAlertDismissedFor: null,
};

export async function getAiSuiteSettings(tenantId: string): Promise<AiSuiteSettingsRow> {
  const [r] = await getDb().select().from(aiSuiteSettings).where(eq(aiSuiteSettings.tenantId, tenantId)).limit(1);
  if (!r) return { ...DEFAULT_AI_SUITE_SETTINGS };
  return {
    reviewLoopEnabled: r.reviewLoopEnabled,
    reviewVoucherAmount: Number(r.reviewVoucherAmount),
    reviewVoucherDays: r.reviewVoucherDays,
    waReviewTemplate: r.waReviewTemplate,
    waTemplateLanguage: r.waTemplateLanguage,
    paydayAlertDismissedFor: r.paydayAlertDismissedFor,
  };
}

export async function saveAiSuiteSettings(tenantId: string, patch: Partial<AiSuiteSettingsRow>): Promise<AiSuiteSettingsRow> {
  const cur = await getAiSuiteSettings(tenantId);
  const next = { ...cur, ...patch };
  const values = {
    tenantId,
    reviewLoopEnabled: next.reviewLoopEnabled,
    reviewVoucherAmount: Math.max(0, Math.min(5000, Number(next.reviewVoucherAmount) || 0)).toFixed(2),
    reviewVoucherDays: Math.max(1, Math.min(365, Math.round(Number(next.reviewVoucherDays) || 30))),
    waReviewTemplate: next.waReviewTemplate?.trim().slice(0, 120) || null,
    waTemplateLanguage: (next.waTemplateLanguage || "en").slice(0, 10),
    paydayAlertDismissedFor: next.paydayAlertDismissedFor,
    updatedAt: new Date(),
  };
  await getDb().insert(aiSuiteSettings).values(values).onConflictDoUpdate({ target: aiSuiteSettings.tenantId, set: values });
  return getAiSuiteSettings(tenantId);
}

// ─── 4.2 Payday alert ─────────────────────────────────────────────────────────

/** Manila calendar date "YYYY-MM-DD". */
export function manilaDate(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** The 14th and 29th (Manila) are payday-prompt days — buyers get paid on the 15th and 30th. */
export function paydayPeriod(now = new Date()): string | null {
  const d = manilaDate(now);
  const day = Number(d.slice(8, 10));
  return day === 14 || day === 29 ? d : null;
}

export async function getPaydayAlert(tenantId: string, now = new Date()): Promise<{ show: boolean; period: string | null }> {
  const period = paydayPeriod(now);
  if (!period) return { show: false, period: null };
  const s = await getAiSuiteSettings(tenantId);
  return { show: s.paydayAlertDismissedFor !== period, period };
}

/** Shops whose plan includes broadcasts (Pro Live, Enterprise Vibe). */
export async function listBroadcastEnabledTenants(): Promise<string[]> {
  const r = await rows<{ id: string }>(sql`
    select t.id from tenants t join merchant_entitlements e on e.tenant_id = t.id
    where t.status = 'active' and e.broadcast_enabled = true order by t.id`);
  return r.map((x) => x.id);
}

export async function dismissPaydayAlert(tenantId: string, now = new Date()): Promise<void> {
  const period = paydayPeriod(now);
  if (period) await saveAiSuiteSettings(tenantId, { paydayAlertDismissedFor: period });
}

// ─── 4.2 Broadcasts ───────────────────────────────────────────────────────────

export class BroadcastError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "STATE" | "EMPTY" | "INVALID"
  ) {
    super(message);
    this.name = "BroadcastError";
  }
}

export type BroadcastChannel = SocialPlatform;
export const MAX_BROADCAST_RECIPIENTS = 5000;
/** Messenger / IG / WhatsApp session messages are only allowed within 24 h of the buyer's last message. */
export const MESSAGING_WINDOW_MS = 24 * 3_600_000;

export interface BroadcastRow {
  id: string;
  name: string;
  channel: BroadcastChannel;
  kind: "payday" | "restock" | "custom";
  segmentTags: BuyerSegmentTag[];
  messageTemplate: string;
  waTemplateName: string | null;
  waTemplateLanguage: string;
  productId: string | null;
  aiPolished: boolean;
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  scheduledAt: Date | null;
  rateLimitPerSec: number;
  recipients: number;
  sent: number;
  failed: number;
  skipped: number;
  createdAt: Date;
  finishedAt: Date | null;
}

function toBroadcast(r: typeof broadcastCampaigns.$inferSelect): BroadcastRow {
  return {
    id: r.id,
    name: r.name,
    channel: r.channel,
    kind: r.kind,
    segmentTags: (r.segmentTags ?? []) as BuyerSegmentTag[],
    messageTemplate: r.messageTemplate,
    waTemplateName: r.waTemplateName,
    waTemplateLanguage: r.waTemplateLanguage,
    productId: r.productId,
    aiPolished: r.aiPolished,
    status: r.status,
    scheduledAt: r.scheduledAt,
    rateLimitPerSec: r.rateLimitPerSec,
    recipients: r.recipients,
    sent: r.sent,
    failed: r.failed,
    skipped: r.skipped,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
  };
}

export interface BroadcastInput {
  name: string;
  channel: BroadcastChannel;
  kind: "payday" | "restock" | "custom";
  segmentTags: BuyerSegmentTag[];
  messageTemplate: string;
  waTemplateName?: string | null;
  waTemplateLanguage?: string | null;
  productId?: string | null;
  aiPolished?: boolean;
  rateLimitPerSec?: number;
}

function cleanBroadcast(input: BroadcastInput) {
  const name = input.name.trim().slice(0, 120);
  const messageTemplate = input.messageTemplate.trim().slice(0, 1000);
  if (!name || messageTemplate.length < 5) throw new BroadcastError("Give it a name and a message.", "INVALID");
  if (input.kind === "restock" && !input.productId) throw new BroadcastError("Pick the product that's back in stock.", "INVALID");
  const tags = [...new Set(input.segmentTags)].filter((t) => BUYER_SEGMENT_TAGS.includes(t));
  return {
    name,
    channel: input.channel,
    kind: input.kind,
    segmentTags: tags,
    messageTemplate,
    waTemplateName: input.channel === "whatsapp" ? input.waTemplateName?.trim().slice(0, 120) || null : null,
    waTemplateLanguage: (input.waTemplateLanguage || "en").trim().slice(0, 10),
    productId: input.productId ?? null,
    aiPolished: input.aiPolished ?? false,
    // 10 msg/s is the plan's limit; sellers may go slower, never faster.
    rateLimitPerSec: Math.max(1, Math.min(10, Math.round(input.rateLimitPerSec ?? 10))),
  };
}

export async function listBroadcasts(tenantId: string, limit = 50): Promise<BroadcastRow[]> {
  const r = await getDb().select().from(broadcastCampaigns).where(eq(broadcastCampaigns.tenantId, tenantId)).orderBy(desc(broadcastCampaigns.createdAt)).limit(limit);
  return r.map(toBroadcast);
}

export async function getBroadcast(tenantId: string, id: string): Promise<BroadcastRow | null> {
  const [r] = await getDb().select().from(broadcastCampaigns).where(and(eq(broadcastCampaigns.id, id), eq(broadcastCampaigns.tenantId, tenantId))).limit(1);
  return r ? toBroadcast(r) : null;
}

export async function createBroadcast(tenantId: string, input: BroadcastInput, createdByName: string): Promise<BroadcastRow> {
  const v = cleanBroadcast(input);
  if (v.productId) await assertOwnProduct(tenantId, v.productId);
  const [r] = await getDb().insert(broadcastCampaigns).values({ tenantId, ...v, createdByName: createdByName.slice(0, 80) }).returning();
  return toBroadcast(r!);
}

export async function updateBroadcast(tenantId: string, id: string, input: BroadcastInput): Promise<BroadcastRow> {
  const v = cleanBroadcast(input);
  if (v.productId) await assertOwnProduct(tenantId, v.productId);
  const [r] = await getDb()
    .update(broadcastCampaigns)
    .set(v)
    .where(and(eq(broadcastCampaigns.id, id), eq(broadcastCampaigns.tenantId, tenantId), eq(broadcastCampaigns.status, "draft")))
    .returning();
  if (!r) throw new BroadcastError("Only drafts can be edited.", "STATE");
  return toBroadcast(r);
}

async function assertOwnProduct(tenantId: string, productId: string): Promise<void> {
  const [p] = await rows<{ id: string }>(sql`select id from products where id = ${productId} and tenant_id = ${tenantId} limit 1`);
  if (!p) throw new BroadcastError("That product isn't in your shop.", "INVALID");
}

export interface AudienceRow {
  buyerKey: string;
  customerId: string | null;
  name: string | null;
  phone: string | null;
  threadId: string | null;
  threadUserId: string | null;
  lastInboundAt: Date | null;
  marketingOptIn: boolean;
  optedOut: boolean;
  lastOrderId: string | null;
  lastItem: string | null;
}

export interface ReachDecision {
  mode: BroadcastSendMode;
  recipientId: string | null;
  skipReason: string | null;
}

/**
 * How (and whether) one buyer can be messaged, under Meta's rules:
 *  - Messenger / Instagram: only inside 24 h of the buyer's last message (no promotional tags).
 *  - WhatsApp: free-form inside the 24 h customer-service window; outside it only with an approved
 *    template, and only to buyers who opted in (wrote to the shop's number, or said yes to marketing).
 */
export function decideReach(row: AudienceRow, channel: BroadcastChannel, hasTemplate: boolean, now = new Date()): ReachDecision {
  if (row.optedOut) return { mode: "none", recipientId: null, skipReason: "opted_out" };
  const inWindow = !!row.lastInboundAt && now.getTime() - row.lastInboundAt.getTime() < MESSAGING_WINDOW_MS;
  if (channel !== "whatsapp") {
    if (!row.threadId || !row.threadUserId) return { mode: "none", recipientId: null, skipReason: "no_chat" };
    return inWindow ? { mode: "session", recipientId: row.threadUserId, skipReason: null } : { mode: "none", recipientId: null, skipReason: "outside_24h" };
  }
  if (row.threadId && row.threadUserId && inWindow) return { mode: "session", recipientId: row.threadUserId, skipReason: null };
  const consent = !!row.threadId || row.marketingOptIn;
  if (!consent) return { mode: "none", recipientId: null, skipReason: "no_opt_in" };
  if (!hasTemplate) return { mode: "none", recipientId: null, skipReason: "needs_template" };
  const digits = (row.threadUserId ?? row.phone ?? "").replace(/\D/g, "");
  const waId = row.threadUserId ? digits : digits.length >= 10 ? `63${digits.slice(-10)}` : "";
  return waId ? { mode: "template", recipientId: waId, skipReason: null } : { mode: "none", recipientId: null, skipReason: "no_number" };
}

/** Buyers in the chosen segments, with their newest chat on the channel and their last order. */
export async function loadAudience(tenantId: string, channel: BroadcastChannel, tags: BuyerSegmentTag[], limit = MAX_BROADCAST_RECIPIENTS): Promise<AudienceRow[]> {
  const tagArr = sql`${`{${tags.join(",")}}`}::text[]`;
  const r = await rows<{
    buyer_key: string;
    customer_id: string | null;
    name: string | null;
    phone: string | null;
    thread_id: string | null;
    thread_user: string | null;
    last_inbound_at: string | null;
    opt_in: boolean | null;
    opted_out: boolean;
    last_order_id: string | null;
    last_item: string | null;
  }>(sql`
    select s.buyer_key, s.customer_id, coalesce(c.name, th.buyer_name) as name, s.phone,
      th.id as thread_id, th.external_user_id as thread_user, th.last_inbound_at::text as last_inbound_at,
      c.sms_marketing_opt_in as opt_in,
      exists (select 1 from messaging_opt_outs x
              where right(regexp_replace(x.phone, '\\D', '', 'g'), 10) = right(regexp_replace(coalesce(s.phone, ''), '\\D', '', 'g'), 10)
                and (x.tenant_id is null or x.tenant_id = ${tenantId})
                and x.channel in (${channel}, 'all')) as opted_out,
      lo.id as last_order_id, lo.item as last_item
    from buyer_crm_segments s
    left join customers c on c.id = s.customer_id
    left join lateral (
      select st.id, st.external_user_id, st.last_inbound_at, st.buyer_name from social_threads st
      where st.tenant_id = ${tenantId} and st.platform = ${channel}
        and ((s.customer_id is not null and st.customer_id = s.customer_id)
          or (${channel} = 'whatsapp' and right(regexp_replace(st.external_user_id, '\\D', '', 'g'), 10) = right(regexp_replace(coalesce(s.phone, ''), '\\D', '', 'g'), 10)))
      order by st.last_inbound_at desc nulls last limit 1
    ) th on true
    left join lateral (
      select o.id, (select i.title_snapshot from order_items i where i.order_id = o.id order by i.id limit 1) as item
      from orders o
      where o.tenant_id = ${tenantId} and o.voided_at is null
        and ((s.customer_id is not null and o.customer_record_id = s.customer_id)
          or right(regexp_replace(coalesce(o.guest_phone, ''), '\\D', '', 'g'), 10) = right(regexp_replace(coalesce(s.phone, ''), '\\D', '', 'g'), 10))
      order by o.created_at desc limit 1
    ) lo on true
    where s.tenant_id = ${tenantId} and (cardinality(${tagArr}) = 0 or s.tags && ${tagArr})
    order by s.last_order_at desc nulls last
    limit ${limit}`);
  return r.map((x) => ({
    buyerKey: x.buyer_key,
    customerId: x.customer_id,
    name: x.name,
    phone: x.phone,
    threadId: x.thread_id,
    threadUserId: x.thread_user,
    lastInboundAt: x.last_inbound_at ? new Date(x.last_inbound_at) : null,
    marketingOptIn: x.opt_in === true,
    optedOut: x.opted_out === true,
    lastOrderId: x.last_order_id,
    lastItem: x.last_item,
  }));
}

export interface AudiencePreview {
  total: number;
  reachable: number;
  session: number;
  template: number;
  skipped: Record<string, number>;
}

export function summarizeReach(decisions: ReachDecision[]): AudiencePreview {
  const skipped: Record<string, number> = {};
  let session = 0;
  let template = 0;
  for (const d of decisions) {
    if (d.mode === "session") session += 1;
    else if (d.mode === "template") template += 1;
    else skipped[d.skipReason ?? "other"] = (skipped[d.skipReason ?? "other"] ?? 0) + 1;
  }
  return { total: decisions.length, reachable: session + template, session, template, skipped };
}

export async function previewBroadcastAudience(
  tenantId: string,
  input: { channel: BroadcastChannel; segmentTags: BuyerSegmentTag[]; waTemplateName?: string | null },
  now = new Date()
): Promise<AudiencePreview> {
  const audience = await loadAudience(tenantId, input.channel, input.segmentTags);
  return summarizeReach(audience.map((a) => decideReach(a, input.channel, !!input.waTemplateName?.trim(), now)));
}

/** Freezes who gets it (and how) and schedules it. `sendAt` null = now. */
export async function queueBroadcast(tenantId: string, id: string, sendAt: Date | null, now = new Date()): Promise<BroadcastRow> {
  const db = getDb();
  const c = await getBroadcast(tenantId, id);
  if (!c) throw new BroadcastError("Broadcast not found.", "NOT_FOUND");
  if (c.status !== "draft") throw new BroadcastError("This broadcast was already scheduled or sent.", "STATE");
  const audience = await loadAudience(tenantId, c.channel, c.segmentTags);
  const decided = audience.map((a) => ({ a, d: decideReach(a, c.channel, !!c.waTemplateName, now) }));
  const reachable = decided.filter((x) => x.d.mode !== "none").length;
  if (reachable === 0) {
    const why = summarizeReach(decided.map((x) => x.d));
    const top = Object.entries(why.skipped).sort((a, b) => b[1] - a[1])[0]?.[0];
    throw new BroadcastError(
      top === "outside_24h" || top === "no_chat"
        ? "Nobody in this group has messaged you in the last 24 hours — Meta only allows promos inside that window."
        : top === "needs_template"
          ? "These buyers are outside WhatsApp's 24-hour window — add an approved WhatsApp template name."
          : "Nobody in this group can be messaged right now.",
      "EMPTY"
    );
  }
  return db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: broadcastCampaigns.status }).from(broadcastCampaigns).where(eq(broadcastCampaigns.id, id)).for("update");
    if (locked?.status !== "draft") throw new BroadcastError("This broadcast was already scheduled or sent.", "STATE");
    for (let i = 0; i < decided.length; i += 500) {
      await tx
        .insert(broadcastRecipients)
        .values(
          decided.slice(i, i + 500).map(({ a, d }) => ({
            campaignId: id,
            tenantId,
            buyerKey: a.buyerKey,
            customerId: a.customerId,
            name: a.name?.slice(0, 160) ?? null,
            threadId: a.threadId,
            recipientId: d.recipientId,
            mode: d.mode,
            lastOrderId: a.lastOrderId,
            lastItem: a.lastItem?.slice(0, 160) ?? null,
            status: d.mode === "none" ? ("skipped" as const) : ("queued" as const),
            skipReason: d.skipReason,
          }))
        )
        .onConflictDoNothing();
    }
    const [r] = await tx
      .update(broadcastCampaigns)
      .set({ status: "scheduled", scheduledAt: sendAt && sendAt > now ? sendAt : now, recipients: decided.length, skipped: decided.length - reachable })
      .where(eq(broadcastCampaigns.id, id))
      .returning();
    return toBroadcast(r!);
  });
}

export async function cancelBroadcast(tenantId: string, id: string): Promise<BroadcastRow> {
  const [r] = await getDb()
    .update(broadcastCampaigns)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(broadcastCampaigns.id, id), eq(broadcastCampaigns.tenantId, tenantId), inArray(broadcastCampaigns.status, ["draft", "scheduled", "sending"])))
    .returning();
  if (!r) throw new BroadcastError("This broadcast can't be cancelled now.", "STATE");
  return toBroadcast(r);
}

export interface BroadcastBatch {
  campaign: BroadcastRow & { tenantId: string; shopSlug: string; shopName: string };
  recipients: Array<typeof broadcastRecipients.$inferSelect>;
}

/** Due broadcasts with their next queued recipients (marks them "sending"). */
export async function claimBroadcastBatches(now = new Date(), perCampaign = 200, maxCampaigns = 5): Promise<BroadcastBatch[]> {
  const db = getDb();
  const due = await db
    .select({ c: broadcastCampaigns, slug: tenants.slug, shopName: tenants.name })
    .from(broadcastCampaigns)
    .innerJoin(tenants, eq(tenants.id, broadcastCampaigns.tenantId))
    .where(and(inArray(broadcastCampaigns.status, ["scheduled", "sending"]), sql`${broadcastCampaigns.scheduledAt} <= ${now.toISOString()}::timestamptz`))
    .orderBy(broadcastCampaigns.scheduledAt)
    .limit(maxCampaigns);
  const out: BroadcastBatch[] = [];
  for (const { c, slug, shopName } of due) {
    if (c.status === "scheduled") {
      await db.update(broadcastCampaigns).set({ status: "sending", startedAt: now }).where(and(eq(broadcastCampaigns.id, c.id), eq(broadcastCampaigns.status, "scheduled")));
    }
    const recipients = await db
      .select()
      .from(broadcastRecipients)
      .where(and(eq(broadcastRecipients.campaignId, c.id), eq(broadcastRecipients.status, "queued")))
      .limit(perCampaign);
    if (!recipients.length) {
      await finishBroadcastIfDone(c.id, now);
      continue;
    }
    out.push({ campaign: { ...toBroadcast(c), tenantId: c.tenantId, shopSlug: slug, shopName }, recipients });
  }
  return out;
}

export async function recordBroadcastSend(
  recipientId: string,
  campaignId: string,
  result: { status: "sent" | "failed" | "skipped"; body?: string | null; error?: string | null; skipReason?: string | null }
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(broadcastRecipients)
    .set({
      status: result.status,
      body: result.body ?? null,
      error: result.error?.slice(0, 300) ?? null,
      skipReason: result.skipReason ?? null,
      sentAt: result.status === "sent" ? new Date() : null,
    })
    .where(and(eq(broadcastRecipients.id, recipientId), eq(broadcastRecipients.status, "queued")))
    .returning({ id: broadcastRecipients.id });
  if (!updated.length) return;
  const col = result.status === "sent" ? broadcastCampaigns.sent : result.status === "failed" ? broadcastCampaigns.failed : broadcastCampaigns.skipped;
  await db.update(broadcastCampaigns).set({ [result.status]: sql`${col} + 1` }).where(eq(broadcastCampaigns.id, campaignId));
}

export async function finishBroadcastIfDone(campaignId: string, now = new Date()): Promise<boolean> {
  const db = getDb();
  const [left] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(broadcastRecipients)
    .where(and(eq(broadcastRecipients.campaignId, campaignId), eq(broadcastRecipients.status, "queued")));
  if (Number(left?.n ?? 0) > 0) return false;
  await db.update(broadcastCampaigns).set({ status: "sent", finishedAt: now }).where(and(eq(broadcastCampaigns.id, campaignId), eq(broadcastCampaigns.status, "sending")));
  return true;
}

export async function isBroadcastActive(campaignId: string): Promise<boolean> {
  const [c] = await getDb().select({ status: broadcastCampaigns.status }).from(broadcastCampaigns).where(eq(broadcastCampaigns.id, campaignId)).limit(1);
  return c?.status === "sending" || c?.status === "scheduled";
}

/** Fill the seller's {name} / {item} / {link} / {shop} placeholders for one buyer. */
export function fillBroadcastTemplate(template: string, v: { name: string | null; item: string | null; link: string; shop: string }): string {
  const first = (v.name ?? "").trim().split(/\s+/)[0] || "po";
  return template
    .replace(/\{name\}/gi, first.slice(0, 40))
    .replace(/\{item\}/gi, (v.item ?? "your favorites").slice(0, 80))
    .replace(/\{shop\}/gi, v.shop.slice(0, 80))
    .replace(/\{link\}/gi, v.link)
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, 1500);
}

// ─── 4.2 Reorder links (kart.guma.one/{shop}/reorder/{orderId}) ───────────────

/**
 * A fresh checkout link with the same items as a past order (only products still for sale; stock
 * is checked again at checkout). One live link per order is reused. No buyer details are copied —
 * the URL can be forwarded.
 */
export async function createReorderLink(
  tenantSlug: string,
  orderId: string,
  opts: { channel?: CheckoutLinkShareChannel | null; now?: Date } = {}
): Promise<{ code: string } | null> {
  const now = opts.now ?? new Date();
  const [o] = await rows<{ id: string; tenant_id: string }>(sql`
    select o.id, o.tenant_id from orders o join tenants t on t.id = o.tenant_id
    where o.id = ${orderId} and t.slug = ${tenantSlug} and t.status = 'active' and o.voided_at is null limit 1`);
  if (!o) return null;
  const session = `reorder:${o.id}`;
  const [existing] = await rows<{ code: string }>(sql`
    select code from checkout_links
    where tenant_id = ${o.tenant_id} and origin = 'reorder' and chat_session_id = ${session} and active = true
      and (expires_at is null or expires_at > ${now.toISOString()}::timestamptz)
    order by created_at desc limit 1`);
  if (existing) return existing;
  const items = await rows<{ product_id: string; variant_id: string | null; quantity: number }>(sql`
    select i.product_id, i.variant_id, sum(i.quantity)::int as quantity
    from order_items i
    join products p on p.id = i.product_id and p.tenant_id = ${o.tenant_id} and p.status = 'active'
    left join product_variants v on v.id = i.variant_id
    where i.order_id = ${o.id} and i.product_id is not null and (i.variant_id is null or v.active = true)
    group by i.product_id, i.variant_id
    limit 20`);
  if (!items.length) return null;
  try {
    const link = await createCheckoutLink(o.tenant_id, null, {
      title: "Order again",
      items: items.map((i) => ({ productId: i.product_id, variantId: i.variant_id, quantity: Math.max(1, Math.min(99, Number(i.quantity) || 1)) })),
      shareChannel: opts.channel ?? null,
      allowQuantityEdit: true,
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      origin: "reorder",
      chatSessionId: session,
    });
    return { code: link.code };
  } catch (error) {
    if (error instanceof CheckoutLinkError) return null;
    throw error;
  }
}

// ─── 4.3 BayanGo review loop ──────────────────────────────────────────────────

export const REVIEW_PROMPT_DELAY_MS = 2 * 3_600_000;
export const REVIEW_REPLY_WINDOW_MS = 7 * 86_400_000;

/** Called when BayanGo reports the delivery done: ask for a review 2 hours later (once per order). */
export async function scheduleReviewPrompt(input: { orderId: string; tenantId: string; deliveryId?: string | null; deliveredAt?: Date }): Promise<boolean> {
  const at = input.deliveredAt ?? new Date();
  const r = await getDb()
    .insert(reviewPrompts)
    .values({ tenantId: input.tenantId, orderId: input.orderId, deliveryId: input.deliveryId ?? null, dueAt: new Date(at.getTime() + REVIEW_PROMPT_DELAY_MS) })
    .onConflictDoNothing()
    .returning({ id: reviewPrompts.id });
  return r.length > 0;
}

export interface DueReviewPrompt {
  id: string;
  tenantId: string;
  shopName: string;
  shopSlug: string;
  orderId: string;
  orderNumber: string;
  accessToken: string | null;
  buyerName: string | null;
  firstItem: string | null;
  plan: string | null;
  thread: { id: string; platform: SocialPlatform; accountId: string; externalUserId: string; lastInboundAt: Date | null } | null;
  phone: string | null;
}

/** Prompts due now with the buyer's best chat (the order's own chat, else their newest one). */
export async function listDueReviewPrompts(now = new Date(), limit = 50): Promise<DueReviewPrompt[]> {
  const r = await rows<{
    id: string;
    tenant_id: string;
    shop_name: string;
    shop_slug: string;
    plan: string | null;
    order_id: string;
    order_number: string;
    access_token: string | null;
    guest_name: string | null;
    guest_phone: string | null;
    first_item: string | null;
    th_id: string | null;
    th_platform: SocialPlatform | null;
    th_account: string | null;
    th_user: string | null;
    th_inbound: string | null;
  }>(sql`
    select p.id, p.tenant_id, t.name as shop_name, t.slug as shop_slug, t.subscription_plan as plan,
      o.id as order_id, o.order_number, o.access_token, o.guest_name, o.guest_phone,
      (select i.title_snapshot from order_items i where i.order_id = o.id order by i.id limit 1) as first_item,
      th.id as th_id, th.platform as th_platform, th.account_id as th_account, th.external_user_id as th_user, th.last_inbound_at::text as th_inbound
    from review_prompts p
    join orders o on o.id = p.order_id
    join tenants t on t.id = p.tenant_id
    left join lateral (
      select st.* from social_threads st
      where st.tenant_id = p.tenant_id
        and (st.id = o.social_thread_id
          or st.id = (select cl.social_thread_id from checkout_links cl where cl.id = o.checkout_link_id)
          or (o.customer_record_id is not null and st.customer_id = o.customer_record_id)
          or (st.platform = 'whatsapp' and o.guest_phone is not null
              and right(regexp_replace(st.external_user_id, '\\D', '', 'g'), 10) = right(regexp_replace(o.guest_phone, '\\D', '', 'g'), 10)))
      order by (st.id = o.social_thread_id) desc, st.last_inbound_at desc nulls last
      limit 1
    ) th on true
    where p.status = 'scheduled' and p.due_at <= ${now.toISOString()}::timestamptz
    order by p.due_at
    limit ${limit}`);
  return r.map((x) => ({
    id: x.id,
    tenantId: x.tenant_id,
    shopName: x.shop_name,
    shopSlug: x.shop_slug,
    plan: x.plan,
    orderId: x.order_id,
    orderNumber: x.order_number,
    accessToken: x.access_token,
    buyerName: x.guest_name,
    firstItem: x.first_item,
    phone: x.guest_phone,
    thread: x.th_id
      ? { id: x.th_id, platform: x.th_platform!, accountId: x.th_account!, externalUserId: x.th_user!, lastInboundAt: x.th_inbound ? new Date(x.th_inbound) : null }
      : null,
  }));
}

export async function markReviewPrompt(
  id: string,
  patch: { status: "sent" | "skipped" | "failed"; threadId?: string | null; channel?: SocialPlatform | null; skipReason?: string | null; error?: string | null }
): Promise<void> {
  await getDb()
    .update(reviewPrompts)
    .set({
      status: patch.status,
      threadId: patch.threadId ?? null,
      channel: patch.channel ?? null,
      skipReason: patch.skipReason ?? null,
      error: patch.error?.slice(0, 300) ?? null,
      sentAt: patch.status === "sent" ? new Date() : null,
    })
    .where(and(eq(reviewPrompts.id, id), eq(reviewPrompts.status, "scheduled")));
}

export interface OpenReviewPrompt {
  id: string;
  orderId: string;
  photos: string[];
}

/** The review question this chat is waiting on (asked in the last 7 days), if any. */
export async function findOpenReviewPrompt(tenantId: string, threadId: string, now = new Date()): Promise<OpenReviewPrompt | null> {
  const [p] = await getDb()
    .select({ id: reviewPrompts.id, orderId: reviewPrompts.orderId, photos: reviewPrompts.photosJson })
    .from(reviewPrompts)
    .where(
      and(
        eq(reviewPrompts.tenantId, tenantId),
        eq(reviewPrompts.threadId, threadId),
        eq(reviewPrompts.status, "sent"),
        sql`${reviewPrompts.sentAt} > ${new Date(now.getTime() - REVIEW_REPLY_WINDOW_MS).toISOString()}::timestamptz`
      )
    )
    .orderBy(desc(reviewPrompts.sentAt))
    .limit(1);
  return p ? { id: p.id, orderId: p.orderId, photos: p.photos ?? [] } : null;
}

/** A photo arrived before the stars: keep it for the review. */
export async function addReviewPromptPhotos(tenantId: string, promptId: string, urls: string[]): Promise<string[]> {
  return getDb().transaction(async (tx) => {
    const [p] = await tx
      .select({ photos: reviewPrompts.photosJson, status: reviewPrompts.status })
      .from(reviewPrompts)
      .where(and(eq(reviewPrompts.id, promptId), eq(reviewPrompts.tenantId, tenantId)))
      .for("update");
    if (!p || p.status !== "sent") return [];
    const photos = [...new Set([...(p.photos ?? []), ...urls])].slice(0, 4);
    await tx.update(reviewPrompts).set({ photosJson: photos }).where(eq(reviewPrompts.id, promptId));
    return photos;
  });
}

export interface ReviewLoopResult {
  status: "reviewed" | "already" | "not_eligible";
  reviewIds: string[];
  voucher: { code: string; amount: number; expiresAt: Date | null } | null;
}

/**
 * The buyer answered in chat: publish a verified review for every item on the delivered order
 * (one per item — the existing product_reviews rule) and issue the single-use thank-you voucher.
 * Idempotent: a second answer to the same prompt changes nothing.
 */
export async function completeReviewFromChat(
  tenantId: string,
  promptId: string,
  input: { rating: number; body?: string | null; photos?: string[] },
  now = new Date()
): Promise<ReviewLoopResult> {
  const rating = Math.round(Number(input.rating));
  if (!(rating >= 1 && rating <= 5)) throw new Error("rating must be 1-5");
  const settings = await getAiSuiteSettings(tenantId);
  return getDb().transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(reviewPrompts)
      .where(and(eq(reviewPrompts.id, promptId), eq(reviewPrompts.tenantId, tenantId)))
      .for("update");
    if (!p || p.status !== "sent") return { status: "already", reviewIds: p?.reviewIds ?? [], voucher: null };
    const [o] = await tx
      .select({ orderState: orders.orderState, fulfillmentState: orders.fulfillmentState, createdAt: orders.createdAt, guestName: orders.guestName, customerId: orders.customerRecordId, phone: orders.guestPhone })
      .from(orders)
      .where(and(eq(orders.id, p.orderId), eq(orders.tenantId, tenantId)))
      .limit(1);
    if (!o || !reviewEligibility({ orderState: o.orderState, fulfillmentState: o.fulfillmentState, createdAt: o.createdAt, now }).ok) {
      await tx.update(reviewPrompts).set({ status: "skipped", skipReason: "not_eligible" }).where(eq(reviewPrompts.id, p.id));
      return { status: "not_eligible", reviewIds: [], voucher: null };
    }
    const body = (input.body ?? "").replace(/\s+/g, " ").trim().slice(0, 1000) || null;
    const photos = [...new Set([...(p.photosJson ?? []), ...(input.photos ?? [])])].filter((u) => typeof u === "string" && u.length < 500).slice(0, 4);
    const items = await tx.select({ id: orderItems.id, productId: orderItems.productId }).from(orderItems).where(eq(orderItems.orderId, p.orderId));
    const reviewIds: string[] = [];
    for (const it of items) {
      if (!it.productId) continue;
      const [rv] = await tx
        .insert(productReviews)
        .values({ tenantId, orderId: p.orderId, orderItemId: it.id, productId: it.productId, rating, body, photosJson: photos, buyerName: reviewDisplayName(o.guestName) })
        .onConflictDoNothing()
        .returning({ id: productReviews.id });
      if (rv) reviewIds.push(rv.id);
    }
    let voucher: ReviewLoopResult["voucher"] = null;
    let cardId: string | null = null;
    if (reviewIds.length && settings.reviewVoucherAmount > 0) {
      const expiresAt = new Date(now.getTime() + settings.reviewVoucherDays * 86_400_000);
      const card = await issueGiftCardInTx(tx, {
        tenantId,
        amount: settings.reviewVoucherAmount,
        kind: "store_credit",
        customerId: o.customerId,
        customerPhone: o.customerId ? null : o.phone,
        recipientName: o.guestName,
        note: "Review thank-you voucher (single use)",
        expiresAt,
        createdByName: "Guma AI review loop",
        orderId: p.orderId,
        singleUse: true,
      });
      voucher = { code: card.code, amount: settings.reviewVoucherAmount, expiresAt };
      cardId = card.id;
    }
    await tx
      .update(reviewPrompts)
      .set({ status: "reviewed", rating, body, photosJson: photos, reviewIds, voucherCardId: cardId, reviewedAt: now })
      .where(eq(reviewPrompts.id, p.id));
    return { status: "reviewed", reviewIds, voucher };
  });
}

export async function expireReviewPrompts(now = new Date()): Promise<number> {
  const r = await getDb()
    .update(reviewPrompts)
    .set({ status: "expired" })
    .where(and(eq(reviewPrompts.status, "sent"), sql`${reviewPrompts.sentAt} < ${new Date(now.getTime() - REVIEW_REPLY_WINDOW_MS).toISOString()}::timestamptz`))
    .returning({ id: reviewPrompts.id });
  return r.length;
}

// ─── 5.1 Printair milestones ──────────────────────────────────────────────────

export const PRINTAIR_ORDER_MILESTONES: Array<{ milestone: PrintairMilestone; orders: number }> = [
  { milestone: "orders_500", orders: 500 },
  { milestone: "orders_100", orders: 100 },
  { milestone: "orders_50", orders: 50 },
  { milestone: "orders_10", orders: 10 },
];

/** Highest order milestone reached for a completed-order count (null under 10). */
export function orderMilestoneFor(completedOrders: number): PrintairMilestone | null {
  return PRINTAIR_ORDER_MILESTONES.find((m) => completedOrders >= m.orders)?.milestone ?? null;
}

export interface PrintairCandidate {
  tenantId: string;
  milestone: PrintairMilestone;
  shopName: string;
  slug: string;
  logoUrl: string | null;
  brandColor: string | null;
  tagline: string | null;
}

/**
 * Shops due a branded-packaging mockup: their first completed Marketing Studio render, or a new
 * completed-orders milestone (only the highest one reached, so a 120-order shop gets one offer).
 */
export async function listPrintairCandidates(limit = 50): Promise<PrintairCandidate[]> {
  const r = await rows<{ id: string; name: string; slug: string; logo_url: string | null; theme: Record<string, unknown> | null; studio: boolean; completed: number }>(sql`
    select t.id, t.name, t.slug, t.logo_url, coalesce(t.theme_published_json, t.theme_json) as theme,
      exists (select 1 from ai_media_jobs j where j.tenant_id = t.id and j.status = 'completed' and j.job_type in ('product_photo', 'video_ad')) as studio,
      (select count(*)::int from orders o where o.tenant_id = t.id and o.voided_at is null
         and coalesce(o.order_state::text, 'open') <> 'cancelled'
         and (o.order_state::text = 'completed' or o.fulfillment_state::text = 'delivered')) as completed
    from tenants t
    where t.status = 'active'
    order by t.id
    limit 2000`);
  const existing = await getDb().select({ tenantId: printairUpsells.tenantId, milestone: printairUpsells.milestone }).from(printairUpsells);
  const have = new Set(existing.map((e) => `${e.tenantId}:${e.milestone}`));
  const out: PrintairCandidate[] = [];
  for (const t of r) {
    const theme = (t.theme ?? {}) as { primaryColor?: string; tagline?: string };
    const base = { tenantId: t.id, shopName: t.name, slug: t.slug, logoUrl: t.logo_url, brandColor: theme.primaryColor ?? null, tagline: theme.tagline ?? null };
    const om = orderMilestoneFor(Number(t.completed));
    if (om && !have.has(`${t.id}:${om}`)) out.push({ ...base, milestone: om });
    else if (t.studio && !have.has(`${t.id}:first_campaign`)) out.push({ ...base, milestone: "first_campaign" });
    if (out.length >= limit) break;
  }
  return out;
}

export async function createPrintairUpsell(tenantId: string, milestone: PrintairMilestone, aiMediaJobId: string | null): Promise<boolean> {
  const r = await getDb().insert(printairUpsells).values({ tenantId, milestone, aiMediaJobId, status: aiMediaJobId ? "rendering" : "failed" }).onConflictDoNothing().returning({ id: printairUpsells.id });
  return r.length > 0;
}

/** rendering → ready / failed, following the background job. */
export async function syncPrintairUpsells(): Promise<number> {
  const r = await rows<{ id: string }>(sql`
    update printair_upsells u set status = case when j.status = 'completed' then 'ready' else 'failed' end, updated_at = now()
    from ai_media_jobs j
    where u.ai_media_job_id = j.id and u.status = 'rendering' and j.status in ('completed', 'failed')
    returning u.id`);
  return r.length;
}

export interface PrintairCard {
  id: string;
  milestone: PrintairMilestone;
  outputs: AiMediaOutput[];
  createdAt: Date;
}

export async function getActivePrintairCard(tenantId: string): Promise<PrintairCard | null> {
  const [r] = await getDb()
    .select({ id: printairUpsells.id, milestone: printairUpsells.milestone, createdAt: printairUpsells.createdAt, outputs: aiMediaJobs.outputUrls })
    .from(printairUpsells)
    .innerJoin(aiMediaJobs, eq(aiMediaJobs.id, printairUpsells.aiMediaJobId))
    .where(and(eq(printairUpsells.tenantId, tenantId), eq(printairUpsells.status, "ready")))
    .orderBy(desc(printairUpsells.createdAt))
    .limit(1);
  return r ? { id: r.id, milestone: r.milestone, outputs: r.outputs ?? [], createdAt: r.createdAt } : null;
}

export async function setPrintairCardStatus(tenantId: string, id: string, action: "dismiss" | "handoff"): Promise<boolean> {
  const set =
    action === "dismiss"
      ? { status: "dismissed" as const, updatedAt: new Date() }
      : { handoffs: sql`${printairUpsells.handoffs} + 1`, lastHandoffAt: new Date(), updatedAt: new Date() };
  const r = await getDb()
    .update(printairUpsells)
    .set(set)
    .where(and(eq(printairUpsells.id, id), eq(printairUpsells.tenantId, tenantId), inArray(printairUpsells.status, ["ready", "dismissed"])))
    .returning({ id: printairUpsells.id });
  return r.length > 0;
}
