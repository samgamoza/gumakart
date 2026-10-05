import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  checkoutLinks,
  orders,
  productImages,
  productVariants,
  products,
  socialAccounts,
  socialMessages,
  socialThreads,
  type ChannelAccountStatus,
  type SocialPlatform,
} from "../schema/index";

/**
 * Phase 13 — Messenger / Instagram inbox (data side). Meta calls live in
 * @gumakart/services (channels/meta); routes stitch them together.
 *
 * Webhook deliveries can repeat: messages are idempotent per (thread, Meta message id).
 * Accounts are unique per (platform, external id) — one Page can belong to one shop.
 */

export const META_REPLY_WINDOW_MS = 24 * 3_600_000;

export class InboxError extends Error {
  constructor(message: string, public code: "NOT_FOUND" | "TAKEN" | "WINDOW_CLOSED" | "INVALID") {
    super(message);
    this.name = "InboxError";
  }
}

export interface SocialAccountRow {
  id: string;
  platform: SocialPlatform;
  externalId: string;
  name: string;
  pageId: string | null;
  status: ChannelAccountStatus;
  lastError: string | null;
  connectedAt: Date;
}

function toAccount(r: typeof socialAccounts.$inferSelect): SocialAccountRow {
  return {
    id: r.id,
    platform: r.platform,
    externalId: r.externalId,
    name: r.name,
    pageId: r.pageId,
    status: r.status,
    lastError: r.lastError,
    connectedAt: r.connectedAt,
  };
}

export async function listSocialAccounts(tenantId: string): Promise<SocialAccountRow[]> {
  const rows = await getDb()
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.tenantId, tenantId), sql`${socialAccounts.status} <> 'disconnected'`))
    .orderBy(asc(socialAccounts.platform), asc(socialAccounts.name));
  return rows.map(toAccount);
}

/**
 * Connect (or reconnect) a Page / Instagram account to a shop. Refuses when another shop
 * already has it connected.
 */
export async function upsertSocialAccount(input: {
  tenantId: string;
  platform: SocialPlatform;
  externalId: string;
  name: string;
  pageId?: string | null;
  accessTokenSealed: string | null;
  status?: ChannelAccountStatus;
}): Promise<SocialAccountRow> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.platform, input.platform), eq(socialAccounts.externalId, input.externalId)))
    .limit(1);
  if (existing && existing.tenantId !== input.tenantId && existing.status !== "disconnected") {
    throw new InboxError(`"${input.name}" is already connected to another Guma Kart shop.`, "TAKEN");
  }
  const values = {
    tenantId: input.tenantId,
    platform: input.platform,
    externalId: input.externalId,
    name: input.name.slice(0, 160),
    pageId: input.pageId ?? null,
    accessTokenSealed: input.accessTokenSealed,
    status: input.status ?? ("connected" as ChannelAccountStatus),
    lastError: null,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(socialAccounts)
    .values(values)
    .onConflictDoUpdate({ target: [socialAccounts.platform, socialAccounts.externalId], set: values })
    .returning();
  return toAccount(row!);
}

export async function disconnectSocialAccount(tenantId: string, accountId: string): Promise<boolean> {
  const rows = await getDb()
    .update(socialAccounts)
    .set({ status: "disconnected", accessTokenSealed: null, updatedAt: new Date() })
    .where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.tenantId, tenantId)))
    .returning({ id: socialAccounts.id });
  return rows.length > 0;
}

export async function markSocialAccountError(accountId: string, error: string): Promise<void> {
  await getDb().update(socialAccounts).set({ status: "error", lastError: error.slice(0, 300), updatedAt: new Date() }).where(eq(socialAccounts.id, accountId));
}

/** For the webhook: which shop's account a Meta event is for. */
export async function findSocialAccountByExternal(platform: SocialPlatform, externalId: string) {
  const [row] = await getDb()
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.platform, platform), eq(socialAccounts.externalId, externalId), sql`${socialAccounts.status} <> 'disconnected'`))
    .limit(1);
  return row ?? null;
}

/** Sending needs the account's sealed token and the Page id. */
export async function getSocialAccountForSend(tenantId: string, accountId: string) {
  const [row] = await getDb()
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

// ─── Messages in ─────────────────────────────────────────────────────────────

export interface IncomingSocialMessage {
  account: { id: string; tenantId: string; platform: SocialPlatform };
  userId: string;
  messageId: string;
  text: string;
  kind: "text" | "image" | "other";
  payload?: Record<string, unknown> | null;
  at: Date;
  /** Sent by the Page itself from Meta's own inbox (echo). */
  echo?: boolean;
  buyerName?: string | null;
}

/**
 * Records one webhook message. Returns the thread id and whether it was new (false =
 * repeated delivery). Echoes of messages we sent ourselves are skipped by their id.
 */
export async function recordSocialMessage(input: IncomingSocialMessage): Promise<{ threadId: string; created: boolean; isNewThread: boolean }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const preview = (input.text || "[attachment]").slice(0, 200);
    const inbound = !input.echo;
    const [existingThread] = await tx
      .select({ id: socialThreads.id })
      .from(socialThreads)
      .where(and(eq(socialThreads.accountId, input.account.id), eq(socialThreads.externalUserId, input.userId)))
      .limit(1);
    const [thread] = await tx
      .insert(socialThreads)
      .values({
        tenantId: input.account.tenantId,
        accountId: input.account.id,
        platform: input.account.platform,
        externalUserId: input.userId,
        buyerName: input.buyerName ?? null,
        lastInboundAt: inbound ? input.at : null,
        lastMessageAt: input.at,
        lastPreview: preview,
        unread: 0,
      })
      .onConflictDoUpdate({
        target: [socialThreads.accountId, socialThreads.externalUserId],
        set: { buyerName: sql`coalesce(${socialThreads.buyerName}, excluded.buyer_name)` },
      })
      .returning({ id: socialThreads.id });
    const threadId = thread!.id;
    if (input.echo) {
      // Our own send coming back before we stored Meta's id: attach the id instead of
      // recording the message twice.
      const claimed = await tx
        .update(socialMessages)
        .set({ externalMessageId: input.messageId })
        .where(
          and(
            eq(socialMessages.threadId, threadId),
            eq(socialMessages.direction, "out"),
            sql`${socialMessages.externalMessageId} is null`,
            sql`${socialMessages.createdAt} > now() - interval '2 minutes'`,
            sql`${socialMessages.id} = (select id from social_messages where thread_id = ${threadId} and direction = 'out' and external_message_id is null order by created_at desc limit 1)`
          )
        )
        .returning({ id: socialMessages.id });
      if (claimed.length > 0) return { threadId, created: false, isNewThread: !existingThread };
    }
    const inserted = await tx
      .insert(socialMessages)
      .values({
        tenantId: input.account.tenantId,
        threadId,
        direction: inbound ? "in" : "out",
        kind: input.kind,
        body: input.text || "[attachment]",
        payloadJson: input.payload ?? null,
        externalMessageId: input.messageId,
        status: inbound ? "received" : "sent",
        sentByName: inbound ? null : "Meta inbox",
        createdAt: input.at,
      })
      .onConflictDoNothing()
      .returning({ id: socialMessages.id });
    if (inserted.length > 0) {
      await tx
        .update(socialThreads)
        .set({
          lastMessageAt: sql`greatest(${socialThreads.lastMessageAt}, ${input.at.toISOString()}::timestamptz)`,
          lastPreview: preview,
          ...(inbound
            ? {
                unread: sql`${socialThreads.unread} + 1`,
                lastInboundAt: sql`greatest(coalesce(${socialThreads.lastInboundAt}, ${input.at.toISOString()}::timestamptz), ${input.at.toISOString()}::timestamptz)`,
                // A buyer writing again reopens a "done" chat.
                status: "open" as const,
              }
            : {}),
        })
        .where(eq(socialThreads.id, threadId));
    }
    return { threadId, created: inserted.length > 0, isNewThread: !existingThread };
  });
}

// ─── Inbox views ─────────────────────────────────────────────────────────────

export interface SocialThreadRow {
  id: string;
  accountId: string;
  accountName: string;
  platform: SocialPlatform;
  buyerName: string | null;
  lastMessageAt: Date;
  lastPreview: string | null;
  unread: number;
  status: "open" | "done";
  canReply: boolean;
  orders: number;
}

export function canReplyNow(lastInboundAt: Date | null, now = new Date()): boolean {
  return Boolean(lastInboundAt && now.getTime() - lastInboundAt.getTime() <= META_REPLY_WINDOW_MS);
}

export async function listSocialThreads(
  tenantId: string,
  options: { status?: "open" | "done" | "all"; q?: string; limit?: number } = {}
): Promise<SocialThreadRow[]> {
  const q = options.q?.trim();
  const rows = await getDb()
    .select({
      t: socialThreads,
      accountName: socialAccounts.name,
      orders: sql<number>`(select count(*)::int from orders o where o.social_thread_id = "social_threads"."id")`,
    })
    .from(socialThreads)
    .innerJoin(socialAccounts, eq(socialAccounts.id, socialThreads.accountId))
    .where(
      and(
        eq(socialThreads.tenantId, tenantId),
        options.status && options.status !== "all" ? eq(socialThreads.status, options.status) : undefined,
        q ? or(ilike(socialThreads.buyerName, `%${q}%`), ilike(socialThreads.lastPreview, `%${q}%`)) : undefined
      )
    )
    .orderBy(desc(socialThreads.lastMessageAt))
    .limit(Math.min(options.limit ?? 50, 200));
  const now = new Date();
  return rows.map(({ t, accountName, orders: n }) => ({
    id: t.id,
    accountId: t.accountId,
    accountName,
    platform: t.platform,
    buyerName: t.buyerName,
    lastMessageAt: t.lastMessageAt,
    lastPreview: t.lastPreview,
    unread: t.unread,
    status: t.status,
    canReply: canReplyNow(t.lastInboundAt, now),
    orders: Number(n),
  }));
}

export interface SocialMessageRow {
  id: string;
  direction: "in" | "out";
  kind: string;
  body: string;
  payload: Record<string, unknown> | null;
  status: string;
  error: string | null;
  sentByName: string | null;
  createdAt: Date;
}

export interface SocialThreadDetail extends SocialThreadRow {
  externalUserId: string;
  lastInboundAt: Date | null;
  messages: SocialMessageRow[];
  linkedOrders: Array<{ id: string; orderNumber: string; total: number; orderState: string | null; createdAt: Date }>;
}

export async function getSocialThread(tenantId: string, threadId: string): Promise<SocialThreadDetail | null> {
  const db = getDb();
  const [row] = await db
    .select({ t: socialThreads, accountName: socialAccounts.name })
    .from(socialThreads)
    .innerJoin(socialAccounts, eq(socialAccounts.id, socialThreads.accountId))
    .where(and(eq(socialThreads.id, threadId), eq(socialThreads.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;
  const [messages, linked] = await Promise.all([
    db.select().from(socialMessages).where(eq(socialMessages.threadId, threadId)).orderBy(desc(socialMessages.createdAt)).limit(200),
    db
      .select({ id: orders.id, orderNumber: orders.orderNumber, total: orders.total, orderState: orders.orderState, createdAt: orders.createdAt })
      .from(orders)
      .where(and(eq(orders.socialThreadId, threadId), eq(orders.tenantId, tenantId)))
      .orderBy(desc(orders.createdAt))
      .limit(20),
  ]);
  const t = row.t;
  return {
    id: t.id,
    accountId: t.accountId,
    accountName: row.accountName,
    platform: t.platform,
    buyerName: t.buyerName,
    externalUserId: t.externalUserId,
    lastInboundAt: t.lastInboundAt,
    lastMessageAt: t.lastMessageAt,
    lastPreview: t.lastPreview,
    unread: t.unread,
    status: t.status,
    canReply: canReplyNow(t.lastInboundAt),
    orders: linked.length,
    messages: messages.reverse().map((m) => ({
      id: m.id,
      direction: m.direction,
      kind: m.kind,
      body: m.body,
      payload: m.payloadJson ?? null,
      status: m.status,
      error: m.error,
      sentByName: m.sentByName,
      createdAt: m.createdAt,
    })),
    linkedOrders: linked.map((o) => ({ ...o, total: Number(o.total), orderState: o.orderState ?? null })),
  };
}

export async function markSocialThreadRead(tenantId: string, threadId: string): Promise<void> {
  await getDb().update(socialThreads).set({ unread: 0 }).where(and(eq(socialThreads.id, threadId), eq(socialThreads.tenantId, tenantId)));
}

export async function setSocialThreadStatus(tenantId: string, threadId: string, status: "open" | "done"): Promise<boolean> {
  const rows = await getDb()
    .update(socialThreads)
    .set({ status, ...(status === "done" ? { unread: 0 } : {}) })
    .where(and(eq(socialThreads.id, threadId), eq(socialThreads.tenantId, tenantId)))
    .returning({ id: socialThreads.id });
  return rows.length > 0;
}

export async function countUnreadSocialThreads(tenantId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(socialThreads)
    .where(and(eq(socialThreads.tenantId, tenantId), eq(socialThreads.status, "open"), sql`${socialThreads.unread} > 0`));
  return Number(row?.n ?? 0);
}

// ─── Messages out ────────────────────────────────────────────────────────────

/**
 * Reserve an outgoing message before calling Meta (so a slow send still shows), then
 * finishSocialSend() records what Meta said. Refuses outside Meta's 24-hour window.
 */
export async function beginSocialSend(input: {
  tenantId: string;
  threadId: string;
  kind: "text" | "link" | "product";
  body: string;
  payload?: Record<string, unknown> | null;
  sentByName: string;
  now?: Date;
}) {
  const db = getDb();
  const [row] = await db
    .select({ t: socialThreads })
    .from(socialThreads)
    .where(and(eq(socialThreads.id, input.threadId), eq(socialThreads.tenantId, input.tenantId)))
    .limit(1);
  if (!row) throw new InboxError("Chat not found.", "NOT_FOUND");
  if (!canReplyNow(row.t.lastInboundAt, input.now)) {
    throw new InboxError("It's been more than 24 hours since the buyer's last message, so Meta won't deliver a reply. Wait for them to message again.", "WINDOW_CLOSED");
  }
  const body = input.body.trim();
  if (!body || body.length > 2000) throw new InboxError("Write a message (up to 2,000 characters).", "INVALID");
  const [msg] = await db
    .insert(socialMessages)
    .values({
      tenantId: input.tenantId,
      threadId: input.threadId,
      direction: "out",
      kind: input.kind,
      body,
      payloadJson: input.payload ?? null,
      status: "sent",
      sentByName: input.sentByName.slice(0, 80),
    })
    .returning({ id: socialMessages.id });
  return { messageId: msg!.id, thread: row.t };
}

export async function finishSocialSend(
  tenantId: string,
  threadId: string,
  messageId: string,
  result: { success: boolean; externalMessageId?: string | null; mock?: boolean; error?: string | null },
  preview: string
): Promise<void> {
  const db = getDb();
  await db
    .update(socialMessages)
    .set({
      status: result.success ? (result.mock ? "mock" : "sent") : "failed",
      error: result.error?.slice(0, 300) ?? null,
      externalMessageId: result.externalMessageId ?? null,
    })
    .where(and(eq(socialMessages.id, messageId), eq(socialMessages.tenantId, tenantId)));
  if (result.success) {
    await db
      .update(socialThreads)
      .set({ lastMessageAt: new Date(), lastPreview: preview.slice(0, 200), unread: 0 })
      .where(and(eq(socialThreads.id, threadId), eq(socialThreads.tenantId, tenantId)));
  }
}

/** Orders tagged with any of these threads (for the orders list badge). */
export async function threadsForOrders(orderIds: string[]): Promise<Map<string, { threadId: string; platform: SocialPlatform; buyerName: string | null }>> {
  if (orderIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ orderId: orders.id, threadId: socialThreads.id, platform: socialThreads.platform, buyerName: socialThreads.buyerName })
    .from(orders)
    .innerJoin(socialThreads, eq(socialThreads.id, orders.socialThreadId))
    .where(inArray(orders.id, orderIds));
  return new Map(rows.map((r) => [r.orderId, { threadId: r.threadId, platform: r.platform, buyerName: r.buyerName }]));
}

// ─── What a seller can send from a chat ──────────────────────────────────────

export interface ChatProductCard {
  productId: string;
  variantId: string | null;
  title: string;
  slug: string;
  price: number;
  imageUrl: string | null;
}

/** A product (optionally one size/colour) as a chat card. Active products only. */
export async function getChatProductCard(tenantId: string, productId: string, variantId?: string | null): Promise<ChatProductCard | null> {
  const db = getDb();
  const [p] = await db
    .select({ id: products.id, title: products.title, slug: products.slug, basePrice: products.basePrice, status: products.status })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .limit(1);
  if (!p || p.status !== "active") return null;
  let title = p.title;
  let price = Number(p.basePrice);
  let variantImage: string | null = null;
  if (variantId) {
    const [v] = await db
      .select({ title: productVariants.title, price: productVariants.price, imageUrl: productVariants.imageUrl })
      .from(productVariants)
      .where(and(eq(productVariants.id, variantId), eq(productVariants.productId, productId), eq(productVariants.active, true)))
      .limit(1);
    if (!v) return null;
    title = `${p.title} (${v.title})`;
    price = Number(v.price);
    variantImage = v.imageUrl;
  }
  const [img] = await db
    .select({ url: productImages.url })
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.sortOrder))
    .limit(1);
  return { productId, variantId: variantId ?? null, title, slug: p.slug, price, imageUrl: variantImage ?? img?.url ?? null };
}

export async function getChatCheckoutLink(tenantId: string, linkId: string): Promise<{ id: string; code: string; title: string } | null> {
  const [l] = await getDb()
    .select({ id: checkoutLinks.id, code: checkoutLinks.code, title: checkoutLinks.title, active: checkoutLinks.active })
    .from(checkoutLinks)
    .where(and(eq(checkoutLinks.id, linkId), eq(checkoutLinks.tenantId, tenantId)))
    .limit(1);
  return l && l.active ? { id: l.id, code: l.code, title: l.title } : null;
}

/** Demo (local/dev only): a mock Page so the inbox can be tried without Meta. */
export async function ensureDemoSocialAccount(tenantId: string, shopName: string, platform: SocialPlatform = "messenger"): Promise<SocialAccountRow> {
  return upsertSocialAccount({
    tenantId,
    platform,
    externalId: `demo-${platform}-${tenantId.slice(0, 8)}`,
    name: platform === "instagram" ? `@${shopName.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20)} (demo)` : `${shopName} (demo Page)`,
    accessTokenSealed: null,
    status: "mock",
  });
}

export async function setSocialMessageContent(
  tenantId: string,
  messageId: string,
  content: { kind: "text" | "link" | "product"; body: string; payload: Record<string, unknown> | null }
): Promise<void> {
  await getDb()
    .update(socialMessages)
    .set({ kind: content.kind, body: content.body.slice(0, 4000) || "…", payloadJson: content.payload })
    .where(and(eq(socialMessages.id, messageId), eq(socialMessages.tenantId, tenantId)));
}
