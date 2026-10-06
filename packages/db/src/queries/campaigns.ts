import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../client";
import { smsCampaignRecipients, smsCampaigns, type CampaignStatus } from "../schema/index";

/**
 * Phase 14 — customer segments and SMS campaigns (marketing → consent only).
 *
 * Who can get a campaign: the shop's customers who ticked "text me" at checkout
 * (customers.sms_marketing_opt_in), with a valid PH mobile, and who haven't opted out
 * (STOP link) for this shop or all shops. Recipients are snapshotted when the campaign is
 * queued; the sender (admin cron) re-checks opt-outs per message through sendWithLog, sends
 * outside quiet hours only, and never texts a number twice for the same campaign.
 */

export const SEGMENT_KINDS = ["all", "repeat", "vip", "lapsed", "new", "channel", "suki"] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

export interface CampaignSegment {
  kind: SegmentKind;
  /** vip: total spend at least this (pesos). */
  minSpend?: number;
  /** lapsed: no order in this many days; new: first order within this many days. */
  days?: number;
  /** channel: bought at least once through this sales channel. */
  channel?: string;
  /** Phase 32 suki: Suki tier at least this (12-month spend vs the shop's tier amounts) and no order in `days`. */
  minTier?: "silver" | "gold" | "platinum";
}

export const MAX_CAMPAIGN_RECIPIENTS = 5000;

export class CampaignError extends Error {
  constructor(message: string, public code: "INVALID" | "NOT_FOUND" | "STATE" | "EMPTY") {
    super(message);
    this.name = "CampaignError";
  }
}

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await getDb().execute(q)) as unknown as T[];

export function normalizeSegment(raw: unknown): CampaignSegment {
  const s = (raw ?? {}) as Record<string, unknown>;
  const kind = (SEGMENT_KINDS as readonly string[]).includes(String(s.kind)) ? (s.kind as SegmentKind) : "all";
  const out: CampaignSegment = { kind };
  if (kind === "vip") out.minSpend = Math.max(1, Math.min(Number(s.minSpend) || 5000, 10_000_000));
  if (kind === "lapsed") out.days = Math.max(14, Math.min(Math.trunc(Number(s.days) || 60), 730));
  if (kind === "new") out.days = Math.max(1, Math.min(Math.trunc(Number(s.days) || 30), 365));
  if (kind === "suki") {
    out.minTier = s.minTier === "gold" || s.minTier === "platinum" ? s.minTier : "silver";
    out.days = Math.max(14, Math.min(Math.trunc(Number(s.days) || 45), 730));
  }
  if (kind === "channel") out.channel = String(s.channel ?? "facebook").replace(/[^a-z_]/g, "").slice(0, 20) || "facebook";
  return out;
}

export function describeSegment(s: CampaignSegment): string {
  switch (s.kind) {
    case "all":
      return "Everyone who said yes to texts";
    case "repeat":
      return "Repeat buyers (2+ orders)";
    case "vip":
      return `VIPs (spent ₱${(s.minSpend ?? 0).toLocaleString("en-PH")}+)`;
    case "lapsed":
      return `No order in ${s.days} days`;
    case "new":
      return `First order in the last ${s.days} days`;
    case "channel":
      return `Bought through ${s.channel}`;
    case "suki":
      return `Suki ${s.minTier === "platinum" ? "Platinum" : s.minTier === "gold" ? "Gold+" : "Silver+"} who haven't ordered in ${s.days} days`;
  }
}

/** SQL selecting (customer_id, phone, name) for a segment, consent and opt-outs applied. */
function segmentQuery(tenantId: string, segment: CampaignSegment, now: Date) {
  const s = normalizeSegment(segment);
  const stats = sql`(
    select o.customer_record_id as cid, count(*) as n, coalesce(sum(o.total - coalesce(o.refunded_amount, 0)), 0) as spent,
           max(o.created_at) as last_at, min(o.created_at) as first_at,
           bool_or(o.sales_channel = ${s.channel ?? ""}) as via_channel,
           coalesce(sum(greatest(0, o.total - coalesce(o.delivery_fee, 0) - coalesce(o.gift_card_amount, 0) - coalesce(o.refunded_amount, 0)))
             filter (where o.created_at >= ${new Date(now.getTime() - 365 * 86_400_000).toISOString()}::timestamptz), 0) as spent12m
    from orders o
    where o.tenant_id = ${tenantId} and o.customer_record_id is not null
      and coalesce(o.order_state::text, 'open') <> 'cancelled' and o.voided_at is null
    group by o.customer_record_id)`;
  const filter =
    s.kind === "repeat"
      ? sql`st.n >= 2`
      : s.kind === "vip"
        ? sql`st.spent >= ${s.minSpend ?? 0}`
        : s.kind === "lapsed"
          ? sql`st.last_at < ${new Date(now.getTime() - (s.days ?? 60) * 86_400_000).toISOString()}::timestamptz`
          : s.kind === "new"
            ? sql`st.first_at >= ${new Date(now.getTime() - (s.days ?? 30) * 86_400_000).toISOString()}::timestamptz`
            : s.kind === "channel"
              ? sql`st.via_channel`
              : s.kind === "suki"
                ? sql`st.last_at < ${new Date(now.getTime() - (s.days ?? 45) * 86_400_000).toISOString()}::timestamptz
                    and st.spent12m >= coalesce((select (t.settings_json -> 'loyalty' -> 'tiers' ->> ${s.minTier ?? "silver"})::numeric from tenants t where t.id = ${tenantId}),
                                                ${s.minTier === "platinum" ? 40000 : s.minTier === "gold" ? 15000 : 5000})`
                : sql`true`;
  return sql`
    select c.id as customer_id, c.phone, c.name
    from customers c join ${stats} st on st.cid = c.id
    where c.tenant_id = ${tenantId}
      and c.sms_marketing_opt_in = true
      and regexp_replace(c.phone, '\\D', '', 'g') ~ '^(63|0)?9[0-9]{9}$'
      and not exists (
        select 1 from messaging_opt_outs x
        where right(regexp_replace(x.phone, '\\D', '', 'g'), 10) = right(regexp_replace(c.phone, '\\D', '', 'g'), 10)
          and x.channel = 'sms' and x.scope in ('marketing', 'all')
          and (x.tenant_id is null or x.tenant_id = ${tenantId}))
      and ${filter}`;
}

export async function previewSegment(tenantId: string, segment: CampaignSegment, now = new Date()): Promise<{ count: number; sample: string[]; consented: number }> {
  const [count] = await rows<{ n: string }>(sql`select count(*) as n from (${segmentQuery(tenantId, segment, now)}) s`);
  const sample = await rows<{ name: string | null }>(sql`select name from (${segmentQuery(tenantId, segment, now)}) s where name is not null limit 5`);
  const [consented] = await rows<{ n: string }>(sql`select count(*) as n from customers where tenant_id = ${tenantId} and sms_marketing_opt_in = true`);
  return { count: Number(count?.n ?? 0), sample: sample.map((r) => r.name!).filter(Boolean), consented: Number(consented?.n ?? 0) };
}

export interface CampaignRow {
  id: string;
  name: string;
  segment: CampaignSegment;
  segmentLabel: string;
  body: string;
  status: CampaignStatus;
  scheduledAt: Date | null;
  recipients: number;
  sent: number;
  failed: number;
  suppressed: number;
  createdByName: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** Orders placed through the campaign's link (utm_campaign), and their value. */
  orders: number;
  sales: number;
}

/** The tag put on the campaign's link (?ref=sms&utm_campaign=…). */
export function campaignTag(id: string): string {
  return `c${id.replace(/-/g, "").slice(0, 10)}`;
}

function toRow(c: typeof smsCampaigns.$inferSelect, attributed?: { orders: number; sales: number }): CampaignRow {
  const segment = normalizeSegment(c.segmentJson);
  return {
    id: c.id,
    name: c.name,
    segment,
    segmentLabel: describeSegment(segment),
    body: c.body,
    status: c.status,
    scheduledAt: c.scheduledAt,
    recipients: c.recipients,
    sent: c.sent,
    failed: c.failed,
    suppressed: c.suppressed,
    createdByName: c.createdByName,
    createdAt: c.createdAt,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    orders: attributed?.orders ?? 0,
    sales: attributed?.sales ?? 0,
  };
}

export async function listCampaigns(tenantId: string, limit = 50): Promise<CampaignRow[]> {
  const list = await getDb().select().from(smsCampaigns).where(eq(smsCampaigns.tenantId, tenantId)).orderBy(desc(smsCampaigns.createdAt)).limit(limit);
  if (list.length === 0) return [];
  const tags = list.map((c) => campaignTag(c.id));
  const attributed = await rows<{ tag: string; n: string; sales: string }>(sql`
    select o.utm_json->>'utm_campaign' as tag, count(*) as n, coalesce(sum(o.total - coalesce(o.refunded_amount, 0)), 0) as sales
    from orders o
    where o.tenant_id = ${tenantId} and o.utm_json->>'utm_campaign' in (${sql.join(tags.map((t) => sql`${t}`), sql`, `)})
      and coalesce(o.order_state::text, 'open') <> 'cancelled'
    group by 1`);
  const byTag = new Map(attributed.map((a) => [a.tag, { orders: Number(a.n), sales: Math.round(Number(a.sales) * 100) / 100 }]));
  return list.map((c) => toRow(c, byTag.get(campaignTag(c.id))));
}

export async function getCampaign(tenantId: string, id: string) {
  const [c] = await getDb().select().from(smsCampaigns).where(and(eq(smsCampaigns.id, id), eq(smsCampaigns.tenantId, tenantId))).limit(1);
  return c ?? null;
}

function checkBody(body: string): string {
  const b = body.trim();
  if (b.length < 5) throw new CampaignError("Write the message (at least a few words).", "INVALID");
  if (b.length > 300) throw new CampaignError("Keep it under 300 characters — long texts cost more.", "INVALID");
  return b;
}

export async function createCampaign(input: { tenantId: string; name: string; segment: CampaignSegment; body: string; createdByName: string }): Promise<CampaignRow> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new CampaignError("Name the campaign.", "INVALID");
  const [row] = await getDb()
    .insert(smsCampaigns)
    .values({ tenantId: input.tenantId, name, segmentJson: normalizeSegment(input.segment) as unknown as Record<string, unknown>, body: checkBody(input.body), createdByName: input.createdByName.slice(0, 80) })
    .returning();
  return toRow(row!);
}

export async function updateCampaign(tenantId: string, id: string, patch: { name?: string; segment?: CampaignSegment; body?: string }): Promise<CampaignRow> {
  const c = await getCampaign(tenantId, id);
  if (!c) throw new CampaignError("Campaign not found.", "NOT_FOUND");
  if (c.status !== "draft") throw new CampaignError("Only drafts can be edited.", "STATE");
  const [row] = await getDb()
    .update(smsCampaigns)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 120) || c.name } : {}),
      ...(patch.segment ? { segmentJson: normalizeSegment(patch.segment) as unknown as Record<string, unknown> } : {}),
      ...(patch.body !== undefined ? { body: checkBody(patch.body) } : {}),
    })
    .where(eq(smsCampaigns.id, id))
    .returning();
  return toRow(row!);
}

/**
 * Locks in who gets it (consent and opt-outs checked now, and again per message) and
 * schedules it. `sendAt` null = as soon as possible (outside quiet hours).
 */
export async function queueCampaign(tenantId: string, id: string, sendAt: Date | null, now = new Date()): Promise<CampaignRow> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(smsCampaigns).where(and(eq(smsCampaigns.id, id), eq(smsCampaigns.tenantId, tenantId))).for("update");
    if (!c) throw new CampaignError("Campaign not found.", "NOT_FOUND");
    if (c.status !== "draft") throw new CampaignError("This campaign was already scheduled or sent.", "STATE");
    const segment = normalizeSegment(c.segmentJson);
    await tx.execute(sql`
      insert into sms_campaign_recipients (campaign_id, customer_id, phone, name)
      select ${id}, s.customer_id, s.phone, s.name from (${segmentQuery(tenantId, segment, now)}) s
      limit ${MAX_CAMPAIGN_RECIPIENTS}
      on conflict do nothing`);
    const [n] = (await tx.execute(sql`select count(*)::int as n from sms_campaign_recipients where campaign_id = ${id}`)) as unknown as Array<{ n: number }>;
    const recipients = Number(n?.n ?? 0);
    if (recipients === 0) throw new CampaignError("Nobody in this group has said yes to texts yet.", "EMPTY");
    const [row] = await tx
      .update(smsCampaigns)
      .set({ status: "scheduled", scheduledAt: sendAt && sendAt > now ? sendAt : now, recipients })
      .where(eq(smsCampaigns.id, id))
      .returning();
    return toRow(row!);
  });
}

/** Stops a scheduled/sending campaign; texts already sent stay sent. */
export async function cancelCampaign(tenantId: string, id: string): Promise<CampaignRow> {
  const [row] = await getDb()
    .update(smsCampaigns)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(smsCampaigns.id, id), eq(smsCampaigns.tenantId, tenantId), inArray(smsCampaigns.status, ["draft", "scheduled", "sending"])))
    .returning();
  if (!row) throw new CampaignError("This campaign can't be cancelled now.", "STATE");
  return toRow(row);
}

// ─── Sending (admin cron) ────────────────────────────────────────────────────

export interface CampaignBatch {
  campaign: { id: string; tenantId: string; body: string; name: string };
  recipients: Array<{ id: string; phone: string; name: string | null; customerId: string | null }>;
}

/** Due campaigns with a batch of queued recipients each (marks them "sending"). */
export async function claimCampaignBatches(now = new Date(), perCampaign = 100, maxCampaigns = 10): Promise<CampaignBatch[]> {
  const db = getDb();
  const due = await db
    .select()
    .from(smsCampaigns)
    .where(and(inArray(smsCampaigns.status, ["scheduled", "sending"]), sql`${smsCampaigns.scheduledAt} <= ${now.toISOString()}::timestamptz`))
    .orderBy(smsCampaigns.scheduledAt)
    .limit(maxCampaigns);
  const out: CampaignBatch[] = [];
  for (const c of due) {
    if (c.status === "scheduled") {
      await db.update(smsCampaigns).set({ status: "sending", startedAt: now }).where(and(eq(smsCampaigns.id, c.id), eq(smsCampaigns.status, "scheduled")));
    }
    const recipients = await db
      .select({ id: smsCampaignRecipients.id, phone: smsCampaignRecipients.phone, name: smsCampaignRecipients.name, customerId: smsCampaignRecipients.customerId })
      .from(smsCampaignRecipients)
      .where(and(eq(smsCampaignRecipients.campaignId, c.id), eq(smsCampaignRecipients.status, "queued")))
      .limit(perCampaign);
    if (recipients.length === 0) {
      await finishCampaignIfDone(c.id, now);
      continue;
    }
    out.push({ campaign: { id: c.id, tenantId: c.tenantId, body: c.body, name: c.name }, recipients });
  }
  return out;
}

export async function recordCampaignSend(recipientId: string, campaignId: string, status: "sent" | "failed" | "suppressed", error?: string | null): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(smsCampaignRecipients)
    .set({ status, error: error?.slice(0, 300) ?? null, sentAt: status === "sent" ? new Date() : null })
    .where(and(eq(smsCampaignRecipients.id, recipientId), eq(smsCampaignRecipients.status, "queued")))
    .returning({ id: smsCampaignRecipients.id });
  if (updated.length === 0) return;
  const col = status === "sent" ? smsCampaigns.sent : status === "failed" ? smsCampaigns.failed : smsCampaigns.suppressed;
  await db.update(smsCampaigns).set({ [status]: sql`${col} + 1` }).where(eq(smsCampaigns.id, campaignId));
}

export async function finishCampaignIfDone(campaignId: string, now = new Date()): Promise<boolean> {
  const db = getDb();
  const [left] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(smsCampaignRecipients)
    .where(and(eq(smsCampaignRecipients.campaignId, campaignId), eq(smsCampaignRecipients.status, "queued")));
  if (Number(left?.n ?? 0) > 0) return false;
  await db.update(smsCampaigns).set({ status: "sent", finishedAt: now }).where(and(eq(smsCampaigns.id, campaignId), eq(smsCampaigns.status, "sending")));
  return true;
}

/** Campaigns still waiting for their (cancelled) recipients: skip the cancelled ones. */
export async function isCampaignActive(campaignId: string): Promise<boolean> {
  const [c] = await getDb().select({ status: smsCampaigns.status }).from(smsCampaigns).where(eq(smsCampaigns.id, campaignId)).limit(1);
  return c?.status === "sending" || c?.status === "scheduled";
}
