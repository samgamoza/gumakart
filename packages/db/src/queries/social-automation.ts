import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  abandonedCartNudges,
  checkoutLinkItems,
  checkoutLinks,
  contentQueue,
  merchantEntitlements,
  productVariants,
  products,
  socialAccounts,
  socialAutomationRules,
  socialCommentActions,
  socialMessages,
  socialThreads,
  tenants,
  type CheckoutPrefill,
  type SocialPlatform,
} from "../schema/index";
import { normalizeShippingJson, shippingFromLegacyDelivery, legacyDeliveryFromShipping, type TenantShippingJson } from "../types/tenant-shipping";
import { CheckoutLinkError, createCheckoutLink, getCheckoutLinkShopOptions, AI_CHAT_LINKS_PER_DAY, type CheckoutLinkPaymentMethod } from "./checkout-links";

/**
 * AI Marketing Suite Phase 3 — comment-to-DM, the 24/7 AI sales closer and abandoned-cart recovery.
 * Webhooks and crons run without a seller session; every write still names the shop.
 */

// ─── Comment-to-DM ────────────────────────────────────────────────────────────

export interface CommentRuleMatch {
  ruleId: string;
  keywords: string[];
  publicReplies: string[];
  productId: string | null;
  postSpecific: boolean;
}

/** Post ids arrive as "<pageId>_<postId>" (Graph) or just "<postId>"; sellers may store either. */
export function postIdVariants(postId: string): string[] {
  const out = new Set([postId]);
  const i = postId.indexOf("_");
  if (i > 0) out.add(postId.slice(i + 1));
  return [...out];
}

/**
 * The rule for a comment: a rule attached to this post wins over the shop's global rule.
 * Pending Marketing Studio rules (post not attached yet) never match.
 */
export async function findCommentRule(tenantId: string, accountId: string, postId: string | null): Promise<CommentRuleMatch | null> {
  const variants = postId ? postIdVariants(postId) : [];
  const rows = await getDb()
    .select({ rule: socialAutomationRules, post: contentQueue })
    .from(socialAutomationRules)
    .leftJoin(contentQueue, eq(contentQueue.id, socialAutomationRules.contentQueueId))
    .where(
      and(
        eq(socialAutomationRules.tenantId, tenantId),
        eq(socialAutomationRules.isActive, true),
        or(isNull(socialAutomationRules.accountId), eq(socialAutomationRules.accountId, accountId)),
        or(
          variants.length
            ? or(
                inArray(socialAutomationRules.postId, variants),
                // stored "<pageId>_<postId>" vs incoming bare id, or the reverse
                ...variants.map((v) => sql`${socialAutomationRules.postId} like ${"%\\_" + v}`)
              )
            : sql`false`,
          and(isNull(socialAutomationRules.postId), isNull(socialAutomationRules.contentQueueId))
        )
      )
    );
  if (!rows.length) return null;
  const specific = rows.find((r) => r.rule.postId !== null);
  const pick = specific ?? rows.find((r) => r.rule.accountId === accountId) ?? rows[0]!;
  const fromPost = (pick.post?.outputJson as { productId?: string | null } | null)?.productId ?? null;
  return {
    ruleId: pick.rule.id,
    keywords: pick.rule.triggerKeywords,
    publicReplies: pick.rule.publicReplyTemplates,
    productId: pick.rule.productId ?? fromPost,
    postSpecific: pick.rule.postId !== null,
  };
}

export interface ClaimCommentInput {
  tenantId: string;
  accountId: string;
  platform: SocialPlatform;
  commentId: string;
  postId: string | null;
  commenterId: string | null;
  commenterName: string | null;
  text: string;
}

/** Returns the action id, or null when this comment was already handled (webhook retry). */
export async function claimCommentAction(input: ClaimCommentInput): Promise<string | null> {
  const [row] = await getDb()
    .insert(socialCommentActions)
    .values({
      tenantId: input.tenantId,
      accountId: input.accountId,
      platform: input.platform,
      commentId: input.commentId,
      postId: input.postId,
      commenterId: input.commenterId,
      commenterName: input.commenterName?.slice(0, 160) ?? null,
      commentText: input.text.slice(0, 1000),
    })
    .onConflictDoNothing()
    .returning({ id: socialCommentActions.id });
  return row?.id ?? null;
}

/** Did we already DM this person about this post recently (they commented "mine" three times)? */
export async function alreadyMessagedCommenter(tenantId: string, accountId: string, postId: string | null, commenterId: string, sinceMs = 24 * 3_600_000): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: socialCommentActions.id })
    .from(socialCommentActions)
    .where(
      and(
        eq(socialCommentActions.tenantId, tenantId),
        eq(socialCommentActions.accountId, accountId),
        postId ? eq(socialCommentActions.postId, postId) : isNull(socialCommentActions.postId),
        eq(socialCommentActions.commenterId, commenterId),
        eq(socialCommentActions.status, "replied"),
        sql`${socialCommentActions.createdAt} > now() - make_interval(secs => ${Math.round(sinceMs / 1000)})`
      )
    )
    .limit(1);
  return Boolean(row);
}

export async function finishCommentAction(
  tenantId: string,
  actionId: string,
  patch: {
    status: "replied" | "skipped" | "failed";
    ruleId?: string | null;
    matchedKeyword?: string | null;
    skipReason?: string | null;
    publicReplyId?: string | null;
    privateReplyId?: string | null;
    threadId?: string | null;
    error?: string | null;
  }
): Promise<void> {
  await getDb()
    .update(socialCommentActions)
    .set({
      status: patch.status,
      ruleId: patch.ruleId ?? null,
      matchedKeyword: patch.matchedKeyword?.slice(0, 60) ?? null,
      skipReason: patch.skipReason?.slice(0, 60) ?? null,
      publicReplyId: patch.publicReplyId ?? null,
      privateReplyId: patch.privateReplyId ?? null,
      threadId: patch.threadId ?? null,
      error: patch.error?.slice(0, 300) ?? null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(socialCommentActions.id, actionId), eq(socialCommentActions.tenantId, tenantId)));
}

/** Thread for a buyer we're messaging first (private reply to a comment). */
export async function ensureSocialThread(input: { tenantId: string; accountId: string; platform: SocialPlatform; externalUserId: string; buyerName?: string | null }): Promise<string> {
  const [row] = await getDb()
    .insert(socialThreads)
    .values({
      tenantId: input.tenantId,
      accountId: input.accountId,
      platform: input.platform,
      externalUserId: input.externalUserId,
      buyerName: input.buyerName ?? null,
      lastMessageAt: new Date(),
      unread: 0,
    })
    .onConflictDoUpdate({
      target: [socialThreads.accountId, socialThreads.externalUserId],
      set: { buyerName: sql`coalesce(${socialThreads.buyerName}, excluded.buyer_name)` },
    })
    .returning({ id: socialThreads.id });
  return row!.id;
}

/**
 * Record a message the automation sent outside the normal reply flow (comment private reply,
 * recovery nudge). Not subject to the 24-hour check — the caller already checked the rule that applies.
 */
export async function recordAutomatedMessage(input: {
  tenantId: string;
  threadId: string;
  kind: "text" | "link" | "product";
  body: string;
  payload?: Record<string, unknown> | null;
  externalMessageId?: string | null;
  status: "sent" | "mock" | "failed";
  error?: string | null;
  sentByName?: string;
}): Promise<string> {
  const db = getDb();
  const [msg] = await db
    .insert(socialMessages)
    .values({
      tenantId: input.tenantId,
      threadId: input.threadId,
      direction: "out",
      kind: input.kind,
      body: input.body.slice(0, 2000),
      payloadJson: input.payload ?? null,
      externalMessageId: input.externalMessageId ?? null,
      status: input.status,
      error: input.error?.slice(0, 300) ?? null,
      sentByName: (input.sentByName ?? "Guma AI").slice(0, 80),
      aiOrigin: "auto",
    })
    .returning({ id: socialMessages.id });
  if (input.status !== "failed") {
    await db
      .update(socialThreads)
      .set({ lastMessageAt: sql`now()`, lastPreview: input.body.slice(0, 200) })
      .where(and(eq(socialThreads.id, input.threadId), eq(socialThreads.tenantId, input.tenantId)));
  }
  return msg!.id;
}

// ─── AI closer: context, state ────────────────────────────────────────────────

export interface CloserMessage {
  id: string;
  direction: "in" | "out";
  body: string;
  aiOrigin: "draft" | "auto" | null;
  createdAt: Date;
}

export interface CloserContext {
  thread: typeof socialThreads.$inferSelect;
  account: typeof socialAccounts.$inferSelect;
  shop: { id: string; name: string; slug: string; subscriptionPlan: string | null };
  closerEnabled: boolean;
  messages: CloserMessage[];
}

/** Everything the closer needs for one thread (last `limit` messages, oldest first). */
export async function getCloserContext(tenantId: string, threadId: string, limit = 20): Promise<CloserContext | null> {
  const db = getDb();
  const [row] = await db
    .select({ thread: socialThreads, account: socialAccounts, shop: tenants, ent: merchantEntitlements })
    .from(socialThreads)
    .innerJoin(socialAccounts, eq(socialAccounts.id, socialThreads.accountId))
    .innerJoin(tenants, eq(tenants.id, socialThreads.tenantId))
    .leftJoin(merchantEntitlements, eq(merchantEntitlements.tenantId, socialThreads.tenantId))
    .where(and(eq(socialThreads.id, threadId), eq(socialThreads.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;
  const msgs = await db
    .select({ id: socialMessages.id, direction: socialMessages.direction, body: socialMessages.body, aiOrigin: socialMessages.aiOrigin, createdAt: socialMessages.createdAt })
    .from(socialMessages)
    .where(and(eq(socialMessages.threadId, threadId), eq(socialMessages.tenantId, tenantId), sql`${socialMessages.status} <> 'failed'`))
    .orderBy(desc(socialMessages.createdAt))
    .limit(limit);
  return {
    thread: row.thread,
    account: row.account,
    shop: { id: row.shop.id, name: row.shop.name, slug: row.shop.slug, subscriptionPlan: row.shop.subscriptionPlan },
    closerEnabled: Boolean(row.ent?.aiCloserEnabled) && row.account.aiCloserMode === "auto" && row.account.status !== "disconnected",
    messages: msgs.reverse(),
  };
}

export async function mergeThreadAiContext(tenantId: string, threadId: string, patch: Record<string, unknown>): Promise<void> {
  await getDb()
    .update(socialThreads)
    .set({ aiContextJson: sql`coalesce(${socialThreads.aiContextJson}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` })
    .where(and(eq(socialThreads.id, threadId), eq(socialThreads.tenantId, tenantId)));
}

/** escalate_to_human_seller: the AI stops answering this chat until the seller resumes it. */
export async function pauseThreadAi(tenantId: string, threadId: string, reason: string): Promise<boolean> {
  const rows = await getDb()
    .update(socialThreads)
    .set({ aiPaused: true, escalationReason: reason.slice(0, 300), conversionStatus: "escalated", status: "open" })
    .where(and(eq(socialThreads.id, threadId), eq(socialThreads.tenantId, tenantId)))
    .returning({ id: socialThreads.id });
  return rows.length > 0;
}

export async function resumeThreadAi(tenantId: string, threadId: string): Promise<boolean> {
  const rows = await getDb()
    .update(socialThreads)
    .set({
      aiPaused: false,
      escalationReason: null,
      conversionStatus: sql`case when ${socialThreads.conversionStatus} = 'escalated' then 'open' else ${socialThreads.conversionStatus} end`,
    })
    .where(and(eq(socialThreads.id, threadId), eq(socialThreads.tenantId, tenantId)))
    .returning({ id: socialThreads.id });
  return rows.length > 0;
}

export async function setSocialAccountCloserMode(tenantId: string, accountId: string, mode: "auto" | "off"): Promise<boolean> {
  const rows = await getDb()
    .update(socialAccounts)
    .set({ aiCloserMode: mode, updatedAt: sql`now()` })
    .where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.tenantId, tenantId)))
    .returning({ id: socialAccounts.id });
  return rows.length > 0;
}

// ─── Tool: check_product_inventory ────────────────────────────────────────────

export interface ChatInventoryVariant {
  variantId: string;
  title: string;
  price: number;
  inStock: boolean;
  /** Exact units left — only when the shop tracks stock for this product (D5: real numbers only). */
  stockLeft: number | null;
}

export interface ChatInventoryProduct {
  productId: string;
  title: string;
  slug: string;
  /** First product photo (for chat product cards). */
  imageUrl: string | null;
  tracksStock: boolean;
  variants: ChatInventoryVariant[];
}

/** Real stock and prices for active products — by id, or by words in the title (best 5). */
export async function findChatInventory(tenantId: string, query: { productId?: string; text?: string }): Promise<ChatInventoryProduct[]> {
  const db = getDb();
  const words = (query.text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3)
    .slice(0, 6);
  if (!query.productId && !words.length) return [];
  const match = query.productId
    ? eq(products.id, query.productId)
    : or(...words.map((w) => sql`lower(${products.title}) like ${"%" + w.replace(/[%_\\]/g, "") + "%"}`));
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      slug: products.slug,
      track: products.trackInventory,
      variantId: productVariants.id,
      variantTitle: productVariants.title,
      price: productVariants.price,
      stock: productVariants.stockQty,
      image: sql<string | null>`(select pi.url from product_images pi where pi.product_id = ${products.id} order by pi.sort_order nulls last, pi.id limit 1)`,
    })
    .from(products)
    .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.active, true)))
    .where(and(eq(products.tenantId, tenantId), eq(products.status, "active"), match))
    .orderBy(asc(products.title), asc(productVariants.position), asc(productVariants.id))
    .limit(60);
  const byId = new Map<string, ChatInventoryProduct & { score: number }>();
  for (const r of rows) {
    const tracks = r.track !== false;
    const p = byId.get(r.id) ?? {
      productId: r.id,
      title: r.title,
      slug: r.slug,
      imageUrl: r.image ?? null,
      tracksStock: tracks,
      variants: [],
      score: words.filter((w) => r.title.toLowerCase().includes(w)).length,
    };
    const stock = r.stock ?? 0;
    p.variants.push({ variantId: r.variantId, title: r.variantTitle ?? "Default", price: Number(r.price), inStock: !tracks || stock > 0, stockLeft: tracks ? Math.max(stock, 0) : null });
    byId.set(r.id, p);
  }
  return [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ score: _s, ...p }) => p);
}

// ─── Tool: create_prefilled_checkout_link ─────────────────────────────────────

export type ChatPaymentMethod = "gcash" | "maya" | "qrph" | "cod";
const TO_LINK_METHOD: Record<ChatPaymentMethod, CheckoutLinkPaymentMethod> = { gcash: "gcash", maya: "paymaya", qrph: "qrph", cod: "cod" };

export type PrefilledLinkResult =
  | { ok: true; linkId: string; code: string; title: string; paymentMethod: ChatPaymentMethod }
  | { ok: false; reason: "payment_unavailable" | "invalid_items" | "daily_cap" | "not_set_up"; message: string; availableMethods?: ChatPaymentMethod[] };

/** Chat payment methods this shop can actually take right now. */
export async function availableChatPaymentMethods(tenantId: string): Promise<ChatPaymentMethod[]> {
  const options = await getCheckoutLinkShopOptions(tenantId);
  return (Object.keys(TO_LINK_METHOD) as ChatPaymentMethod[]).filter((m) => options.paymentMethods.some((o) => o.id === TO_LINK_METHOD[m] && !o.needsSetup));
}

/**
 * A checkout link for this chat: the items the buyer chose, the payment method they picked
 * (only that one, so the page opens on it) and their details pre-filled. Becomes the thread's
 * active link (the 30-minute recovery timer starts now).
 */
export async function createPrefilledChatCheckoutLink(
  tenantId: string,
  input: {
    threadId: string;
    items: Array<{ productId: string; variantId?: string | null; quantity: number }>;
    paymentMethod: ChatPaymentMethod;
    prefill: CheckoutPrefill;
    channel?: SocialPlatform;
    now?: Date;
  }
): Promise<PrefilledLinkResult> {
  const now = input.now ?? new Date();
  const available = await availableChatPaymentMethods(tenantId);
  if (!available.includes(input.paymentMethod)) {
    return { ok: false, reason: "payment_unavailable", message: `${input.paymentMethod} isn't available at this shop.`, availableMethods: available };
  }
  const db = getDb();
  const [made] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(checkoutLinks)
    .where(and(eq(checkoutLinks.tenantId, tenantId), inArray(checkoutLinks.origin, ["ai_auto", "ai_draft"]), sql`${checkoutLinks.createdAt} > ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz`));
  if ((made?.n ?? 0) >= AI_CHAT_LINKS_PER_DAY) return { ok: false, reason: "daily_cap", message: "Daily AI link limit reached." };
  try {
    const link = await createCheckoutLink(tenantId, null, {
      items: input.items.map((i) => ({ productId: i.productId, variantId: i.variantId ?? null, quantity: Math.min(Math.max(1, Math.round(i.quantity)), 99) })),
      origin: "ai_auto",
      socialThreadId: input.threadId,
      shareChannel: input.channel ?? "messenger",
      paymentMethods: [TO_LINK_METHOD[input.paymentMethod]],
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
    });
    const prefill = cleanPrefill({ ...input.prefill, paymentMethod: TO_LINK_METHOD[input.paymentMethod] as CheckoutPrefill["paymentMethod"] });
    await db.update(checkoutLinks).set({ prefillJson: prefill }).where(and(eq(checkoutLinks.id, link.id), eq(checkoutLinks.tenantId, tenantId)));
    await db
      .update(socialThreads)
      .set({ activeCheckoutLinkId: link.id, checkoutLinkSentAt: now, nudgeSentAt: null, conversionStatus: "checkout_started" })
      .where(and(eq(socialThreads.id, input.threadId), eq(socialThreads.tenantId, tenantId)));
    return { ok: true, linkId: link.id, code: link.code, title: link.title, paymentMethod: input.paymentMethod };
  } catch (error) {
    if (error instanceof CheckoutLinkError) {
      return { ok: false, reason: error.code === "INVALID_PRODUCTS" ? "invalid_items" : "not_set_up", message: error.message };
    }
    throw error;
  }
}

export function cleanPrefill(p: CheckoutPrefill): CheckoutPrefill {
  const s = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
  const phoneDigits = typeof p.phone === "string" ? p.phone.replace(/\D/g, "") : "";
  const phone = /^09\d{9}$/.test(phoneDigits) ? phoneDigits : /^639\d{9}$/.test(phoneDigits) ? `0${phoneDigits.slice(2)}` : undefined;
  const out: CheckoutPrefill = {
    name: s(p.name, 120),
    phone,
    addressLine: s(p.addressLine, 200),
    barangay: s(p.barangay, 80),
    city: s(p.city, 80),
    landmark: s(p.landmark, 120),
    paymentMethod: p.paymentMethod,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as CheckoutPrefill;
}

/** Copy of a link's items (for "Switch to COD"). */
export async function getCheckoutLinkItemsForChat(tenantId: string, linkId: string): Promise<{ items: Array<{ productId: string; variantId: string | null; quantity: number }>; prefill: CheckoutPrefill | null } | null> {
  const db = getDb();
  const [link] = await db
    .select({ id: checkoutLinks.id, prefill: checkoutLinks.prefillJson })
    .from(checkoutLinks)
    .where(and(eq(checkoutLinks.id, linkId), eq(checkoutLinks.tenantId, tenantId)))
    .limit(1);
  if (!link) return null;
  const items = await db
    .select({ productId: checkoutLinkItems.productId, variantId: checkoutLinkItems.variantId, quantity: checkoutLinkItems.quantity })
    .from(checkoutLinkItems)
    .where(eq(checkoutLinkItems.linkId, linkId))
    .orderBy(asc(checkoutLinkItems.sortOrder));
  return { items, prefill: link.prefill ?? null };
}

// ─── Tool: quote_bayango_delivery (shop side) ─────────────────────────────────

export interface ShopDeliveryContext {
  pickupAddress: string;
  shipping: TenantShippingJson;
  flatRate: number;
  freeDeliveryMin: number;
}

export async function getShopDeliveryContext(tenantId: string): Promise<ShopDeliveryContext | null> {
  const [t] = await getDb()
    .select({ settings: tenants.settingsJson, shipping: tenants.shippingPublishedJson })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t) return null;
  const legacy = ((t.settings ?? {}) as { delivery?: Parameters<typeof shippingFromLegacyDelivery>[0] }).delivery;
  const shipping = t.shipping ? normalizeShippingJson(t.shipping) : shippingFromLegacyDelivery(legacy);
  const summary = legacyDeliveryFromShipping(shipping);
  return { pickupAddress: summary.pickupAddress, shipping, flatRate: summary.flatRate, freeDeliveryMin: summary.freeDeliveryMin };
}

// ─── Abandoned-cart & ghost-buyer recovery ────────────────────────────────────

export interface CartRecoveryCandidate {
  tenantId: string;
  threadId: string;
  platform: SocialPlatform;
  accountId: string;
  externalUserId: string;
  buyerName: string | null;
  lastInboundAt: Date;
  linkId: string;
  linkCode: string;
  linkTitle: string;
  linkPaymentMethods: string[] | null;
  orderId: string | null;
  orderPaymentState: string | null;
  /** Buyer's own order page (pay / track) when an unpaid order exists: "/<shop>/orders/<no>?t=…". */
  orderPath: string | null;
  closerEnabled: boolean;
  shopName: string;
  shopSlug: string;
}

/**
 * Chats where a checkout link went out ≥ `afterMs` ago and the buyer hasn't paid: no order from
 * that link (ghost buyer) or an order still unpaid. Only chats still inside Meta's 24-hour window
 * (minus `windowMarginMs`), not paused, not nudged for this link yet.
 */
export async function listCartRecoveryCandidates(opts: { now?: Date; afterMs?: number; windowMarginMs?: number; limit?: number } = {}): Promise<CartRecoveryCandidate[]> {
  const now = opts.now ?? new Date();
  const sentBefore = new Date(now.getTime() - (opts.afterMs ?? 30 * 60_000)).toISOString();
  const inboundAfter = new Date(now.getTime() - (24 * 3_600_000 - (opts.windowMarginMs ?? 30 * 60_000))).toISOString();
  // tenant-scope: system — cron over every shop; rows carry their tenant id.
  const rows = (await getDb().execute(sql`
    select t.tenant_id, t.id as thread_id, t.platform, t.account_id, t.external_user_id, t.buyer_name, t.last_inbound_at,
           l.id as link_id, l.code as link_code, l.title as link_title, l.payment_methods as link_payment_methods,
           o.id as order_id, o.payment_state::text as order_payment_state, o.order_number, o.access_token,
           (coalesce(me.ai_closer_enabled, false) and a.ai_closer_mode = 'auto') as closer_enabled,
           s.name as shop_name, s.slug as shop_slug
    from social_threads t
    join checkout_links l on l.id = t.active_checkout_link_id and l.tenant_id = t.tenant_id
    join social_accounts a on a.id = t.account_id and a.status <> 'disconnected'
    join tenants s on s.id = t.tenant_id and s.status = 'active'
    left join merchant_entitlements me on me.tenant_id = t.tenant_id
    left join lateral (
      select o.id, o.payment_state, o.order_number, o.access_token from orders o
      where o.checkout_link_id = l.id and o.tenant_id = t.tenant_id and o.voided_at is null
        and coalesce(o.order_state::text, 'open') <> 'cancelled'
      order by o.created_at desc limit 1
    ) o on true
    where t.nudge_sent_at is null
      and not t.ai_paused
      and t.checkout_link_sent_at is not null
      and t.checkout_link_sent_at <= ${sentBefore}::timestamptz
      and t.last_inbound_at is not null
      and t.last_inbound_at > ${inboundAfter}::timestamptz
      and l.active
      and (o.id is null or coalesce(o.payment_state::text, 'unpaid') in ('unpaid', 'failed'))
      and not exists (select 1 from abandoned_cart_nudges n where n.tenant_id = t.tenant_id and n.thread_id = t.id and n.checkout_link_id = l.id)
    order by t.checkout_link_sent_at
    limit ${opts.limit ?? 50}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    tenantId: String(r.tenant_id),
    threadId: String(r.thread_id),
    platform: r.platform as SocialPlatform,
    accountId: String(r.account_id),
    externalUserId: String(r.external_user_id),
    buyerName: (r.buyer_name as string | null) ?? null,
    lastInboundAt: new Date(String(r.last_inbound_at)),
    linkId: String(r.link_id),
    linkCode: String(r.link_code),
    linkTitle: String(r.link_title),
    linkPaymentMethods: (r.link_payment_methods as string[] | null) ?? null,
    orderId: (r.order_id as string | null) ?? null,
    orderPaymentState: (r.order_payment_state as string | null) ?? null,
    orderPath: r.order_number && r.access_token ? `/${String(r.shop_slug)}/orders/${encodeURIComponent(String(r.order_number))}?t=${String(r.access_token)}` : null,
    closerEnabled: Boolean(r.closer_enabled),
    shopName: String(r.shop_name),
    shopSlug: String(r.shop_slug),
  }));
}

/** Reserve the one nudge for this chat + link; null when another run already took it. */
export async function claimCartNudge(input: { tenantId: string; threadId: string; checkoutLinkId: string; channel: SocialPlatform }): Promise<string | null> {
  const [row] = await getDb()
    .insert(abandonedCartNudges)
    .values({ tenantId: input.tenantId, threadId: input.threadId, checkoutLinkId: input.checkoutLinkId, channel: input.channel })
    .onConflictDoNothing()
    .returning({ id: abandonedCartNudges.id });
  return row?.id ?? null;
}

export async function finishCartNudge(tenantId: string, nudgeId: string, threadId: string, result: { status: "sent" | "failed" | "skipped"; body?: string; error?: string | null }): Promise<void> {
  const db = getDb();
  await db
    .update(abandonedCartNudges)
    .set({ status: result.status, messageBody: result.body ?? null, error: result.error?.slice(0, 300) ?? null, sentAt: result.status === "sent" ? sql`now()` : null })
    .where(and(eq(abandonedCartNudges.id, nudgeId), eq(abandonedCartNudges.tenantId, tenantId)));
  if (result.status === "sent") {
    await db.update(socialThreads).set({ nudgeSentAt: sql`now()` }).where(and(eq(socialThreads.id, threadId), eq(socialThreads.tenantId, tenantId)));
  }
}

/** Mark chats whose link produced a placed/paid order as converted. */
export async function markConvertedThreads(): Promise<number> {
  // tenant-scope: system — cron tidy-up across shops; joins keep tenant ids consistent.
  const rows = (await getDb().execute(sql`
    update social_threads t set conversion_status = 'converted'
    from orders o
    where o.checkout_link_id = t.active_checkout_link_id and o.tenant_id = t.tenant_id
      and t.conversion_status <> 'converted'
      and o.voided_at is null and coalesce(o.order_state::text, 'open') <> 'cancelled'
      and (o.payment_state::text in ('paid', 'cod_due', 'pending_verification') or o.order_state::text = 'completed')
    returning t.id
  `)) as unknown as unknown[];
  return rows.length;
}

/**
 * Chats where the buyer's latest message is still unanswered between `minAgeMs` and `maxAgeMs`
 * old, AI closer on — the safety net if a webhook's background run didn't finish.
 */
export async function listUnansweredCloserThreads(opts: { minAgeMs?: number; maxAgeMs?: number; limit?: number } = {}): Promise<Array<{ tenantId: string; threadId: string }>> {
  // tenant-scope: system — cron over every shop.
  const rows = (await getDb().execute(sql`
    select t.tenant_id, t.id as thread_id
    from social_threads t
    join social_accounts a on a.id = t.account_id and a.ai_closer_mode = 'auto' and a.status <> 'disconnected'
    join merchant_entitlements me on me.tenant_id = t.tenant_id and me.ai_closer_enabled
    join lateral (
      select m.direction, m.created_at from social_messages m
      where m.thread_id = t.id and m.status <> 'failed' order by m.created_at desc limit 1
    ) last on true
    where not t.ai_paused
      and last.direction = 'in'
      and last.created_at < now() - make_interval(secs => ${Math.round((opts.minAgeMs ?? 90_000) / 1000)})
      and last.created_at > now() - make_interval(secs => ${Math.round((opts.maxAgeMs ?? 20 * 60_000) / 1000)})
    order by last.created_at
    limit ${opts.limit ?? 25}
  `)) as unknown as Array<{ tenant_id: string; thread_id: string }>;
  return rows.map((r) => ({ tenantId: r.tenant_id, threadId: r.thread_id }));
}

/** WhatsApp numbers keep their Cloud API ids on the account row. */
export async function setWhatsAppAccountIds(tenantId: string, accountId: string, ids: { phoneNumberId: string; wabaId: string | null }): Promise<void> {
  await getDb()
    .update(socialAccounts)
    .set({ phoneNumberId: ids.phoneNumberId, wabaId: ids.wabaId, updatedAt: sql`now()` })
    .where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.tenantId, tenantId)));
}
