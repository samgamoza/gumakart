import { after } from "next/server";
import {
  bridgeCloserModel,
  bridgeConfigFromEnv,
  cloudCloserModel,
  matchCommentTrigger,
  offerCodSwitch,
  pickPublicReply,
  runCloserTurn,
  writeCartNudge,
  type CloserTools,
  type NudgeInput,
} from "@gumakart/ai";
import {
  alreadyMessagedCommenter,
  availableChatPaymentMethods,
  beginSocialSend,
  claimCartNudge,
  claimCommentAction,
  createPrefilledChatCheckoutLink,
  deletePushSubscriptions,
  ensureSocialThread,
  findChatInventory,
  findCommentRule,
  findSocialAccountByExternal,
  finishCartNudge,
  finishCommentAction,
  finishSocialSend,
  getCheckoutLinkItemsForChat,
  getCloserContext,
  getOrCreateAiCheckoutLink,
  getRawAiUsageCounts,
  getShopDeliveryContext,
  getSocialAccountForSend,
  getTenantSettings,
  InboxError,
  listSocialAccounts,
  parsePostReference,
  listCartRecoveryCandidates,
  listPushSubscriptionsForTenant,
  listUnansweredCloserThreads,
  markConvertedThreads,
  mergeThreadAiContext,
  pauseThreadAi,
  recordAiUsage,
  recordAutomatedMessage,
  withCronLock,
  type CartRecoveryCandidate,
  type ChatPaymentMethod,
  type SocialPlatform,
} from "@gumakart/db";
import { getAiSuiteTier, PLAN_AI_LIMITS } from "@gumakart/plans";
import {
  isPushConfigured,
  openToken,
  quoteChatDelivery,
  rateLimit,
  extractPfbid,
  replyToComment,
  resolveFacebookPostId,
  resolveInstagramMediaId,
  sendPrivateReply,
  sendPushNotifications,
  sendSocialMessage,
  type MetaCommentEvent,
  type MetaOutgoing,
} from "@gumakart/services";
import { checkoutLinkShareUrl, productShareUrl, publicImageUrl } from "@/lib/channels";
import { canAttachTrigger } from "@/lib/marketing-studio";
import { storefrontBaseUrl } from "@/lib/utils";

/**
 * AI Marketing Suite Phase 3 — the glue between Meta / WhatsApp webhooks and the AI:
 *  - comment-to-DM (Starter+): keyword comment → public reply + one private reply with the product;
 *  - the 24/7 Taglish sales closer (Pro Live / Enterprise Vibe): answers DMs with real stock,
 *    BayanGo/Lalamove quotes and pre-filled checkout links, hands over to the seller when unsure;
 *  - abandoned-cart & ghost-buyer recovery: one nudge 30 minutes after an unpaid link, only inside
 *    Meta's 24-hour window.
 * Runs without a seller session (webhooks / cron) — every call names the shop explicitly.
 */

export const AI_SENDER_NAME = "Guma AI";
const SWITCH_COD_PREFIX = "CLOSER:SWITCH_COD:";
/** A seller who typed in the chat recently is handling it — the AI stays quiet. */
const SELLER_ACTIVE_MS = 15 * 60_000;
export const CLOSER_DEBOUNCE_MS = 3_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstName(name: string | null | undefined): string | null {
  const f = (name ?? "").trim().split(/\s+/)[0];
  return f ? f.slice(0, 40) : null;
}

function accountForSend(a: { externalId: string; pageId: string | null; phoneNumberId?: string | null }) {
  return { externalId: a.externalId, pageId: a.pageId, phoneNumberId: a.phoneNumberId ?? null };
}

export async function notifySeller(tenantId: string, input: { title: string; body: string; url: string; tag: string }): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const subs = await listPushSubscriptionsForTenant(tenantId);
    if (!subs.length) return;
    const { expiredEndpoints } = await sendPushNotifications(subs, input);
    if (expiredEndpoints.length) await deletePushSubscriptions(expiredEndpoints);
  } catch (error) {
    console.error("[social-automation] push failed", error);
  }
}

// ─── Background work ─────────────────────────────────────────────────────────
/** Work that may take seconds (Graph calls, the AI) runs after Meta gets its 200. */
export function runAfterResponse(tasks: Array<() => Promise<unknown>>, label: string): void {
  const run = async () => {
    for (const task of tasks) {
      try {
        await task();
      } catch (error) {
        console.error(`[${label}] background task failed`, error);
      }
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

// ─── Comment-to-DM ────────────────────────────────────────────────────────────

export type CommentOutcome = { status: "replied" | "skipped" | "failed" | "ignored" | "duplicate"; reason?: string };

const DEFAULT_PUBLIC_REPLIES = ["Hi {name}! Check your inbox po, nag-PM na kami 😊", "Sent you a DM po {name}! 💌", "Salamat {name}! PM sent po, check mo inbox mo 😊"];

export async function handleCommentEvent(ev: MetaCommentEvent): Promise<CommentOutcome> {
  if (ev.isOwn || !ev.fromId || !ev.text.trim()) return { status: "ignored" };
  const account = await findSocialAccountByExternal(ev.platform, ev.accountExternalId);
  if (!account) return { status: "ignored", reason: "unknown_account" };
  const tenantId = account.tenantId;
  const actionId = await claimCommentAction({
    tenantId,
    accountId: account.id,
    platform: account.platform,
    commentId: ev.commentId,
    postId: ev.postId,
    commenterId: ev.fromId,
    commenterName: ev.fromName,
    text: ev.text,
  });
  if (!actionId) return { status: "duplicate" };
  const skip = async (reason: string, ruleId?: string | null, keyword?: string | null): Promise<CommentOutcome> => {
    await finishCommentAction(tenantId, actionId, { status: "skipped", skipReason: reason, ruleId: ruleId ?? null, matchedKeyword: keyword ?? null });
    return { status: "skipped", reason };
  };
  try {
    const settings = await getTenantSettings(tenantId);
    if (!canAttachTrigger(settings?.subscriptionPlan)) return await skip("plan");
    const rule = await findCommentRule(tenantId, account.id, ev.postId);
    if (!rule) return await skip("no_rule");
    const keyword = matchCommentTrigger(ev.text, rule.keywords);
    if (!keyword) return await skip("no_keyword", rule.ruleId);
    if (await alreadyMessagedCommenter(tenantId, account.id, ev.postId, ev.fromId)) return await skip("already_messaged", rule.ruleId, keyword);

    const token = await openToken(account.accessTokenSealed);
    const name = firstName(ev.fromName);
    const channel = ev.platform === "instagram" ? "instagram" : "messenger";

    // The DM: the post's product with a ready checkout link, or a friendly opener.
    let message: MetaOutgoing;
    let dmKind: "text" | "product" = "text";
    let dmBody: string;
    const product = rule.productId ? (await findChatInventory(tenantId, { productId: rule.productId }))[0] ?? null : null;
    if (product && product.variants.some((v) => v.inStock)) {
      const link =
        product.variants.length === 1
          ? await getOrCreateAiCheckoutLink(tenantId, { productId: product.productId, origin: "ai_auto", chatSessionId: `cm:${account.id}:${ev.fromId}`.slice(0, 120) })
          : null;
      const shop = settings?.slug ?? "";
      const url = link ? checkoutLinkShareUrl(link.code, channel) : productShareUrl(shop, product.slug, channel);
      const prices = product.variants.filter((v) => v.inStock).map((v) => v.price);
      const min = Math.min(...prices);
      const priceText = prices.every((p) => p === min) ? `₱${min.toLocaleString("en-PH")}` : `from ₱${min.toLocaleString("en-PH")}`;
      dmBody = `Hi ${name ?? "po"}! Salamat sa comment 😊 ${product.title} — ${priceText}. Tap mo lang para mag-order, or reply ka dito kung may tanong ka!`;
      message = { type: "product", title: product.title, subtitle: `${priceText} · Reply here if you have questions 😊`, imageUrl: publicImageUrl(product.imageUrl), url, buttonTitle: link ? "Order now" : "View item" };
      dmKind = "product";
    } else {
      dmBody = `Hi ${name ?? "po"}! Salamat sa comment mo 😊 Ano pong gusto mong itanong — price, sizes o delivery? Reply ka lang dito!`;
      message = { type: "text", text: dmBody };
    }

    const pr = await sendPrivateReply({ pageId: account.pageId ?? account.externalId, token, commentId: ev.commentId, message });
    if (!pr.success) {
      await finishCommentAction(tenantId, actionId, { status: "failed", ruleId: rule.ruleId, matchedKeyword: keyword, error: pr.error ?? "Private reply failed" });
      return { status: "failed", reason: pr.error };
    }
    const templates = rule.publicReplies.length ? rule.publicReplies : DEFAULT_PUBLIC_REPLIES;
    const publicText = pickPublicReply(templates, ev.commentId).replace(/\{name\}/g, name ?? "").replace(/\s+([!?.,])/g, "$1").replace(/\s{2,}/g, " ").trim();
    const pub = await replyToComment({ platform: ev.platform, commentId: ev.commentId, message: publicText, token });

    let threadId: string | null = null;
    const recipient = pr.recipientId ?? (ev.platform === "instagram" ? ev.fromId : null);
    if (recipient) {
      threadId = await ensureSocialThread({ tenantId, accountId: account.id, platform: account.platform, externalUserId: recipient, buyerName: ev.fromName });
      await recordAutomatedMessage({
        tenantId,
        threadId,
        kind: dmKind,
        body: dmBody,
        payload: { commentToDm: { commentId: ev.commentId, postId: ev.postId, keyword } },
        externalMessageId: pr.messageId ?? null,
        status: pr.mock ? "mock" : "sent",
        sentByName: AI_SENDER_NAME,
      });
    }
    await finishCommentAction(tenantId, actionId, {
      status: "replied",
      ruleId: rule.ruleId,
      matchedKeyword: keyword,
      publicReplyId: pub.success ? pub.messageId ?? null : null,
      privateReplyId: pr.messageId ?? null,
      threadId,
      error: pub.success ? null : `public reply: ${pub.error ?? "failed"}`,
    });
    return { status: "replied" };
  } catch (error) {
    console.error("[social-automation] comment failed", error);
    await finishCommentAction(tenantId, actionId, { status: "failed", error: error instanceof Error ? error.message : "failed" }).catch(() => undefined);
    return { status: "failed" };
  }
}

// ─── Post links → numeric ids (pfbid / Instagram shortcodes) ─────────────────

export type ResolvedPostRef =
  | { ok: true; postId: string; platform: "facebook" | "instagram" | "tiktok" | "unknown"; resolvedVia: "parsed" | "graph"; notice?: string }
  | { ok: false; error: string; status: number };

/**
 * A pasted post link → the id Meta's comment webhooks carry. Newer Facebook share links
 * (…/posts/pfbid0…, permalink.php?story_fbid=pfbid…) and Instagram shortcodes (/p/Cx…)
 * don't contain it, so we look the post up on the shop's connected Pages / IG accounts.
 */
export async function resolvePostReference(tenantId: string, postRef: string): Promise<ResolvedPostRef> {
  const raw = postRef.trim();
  const parsed = parsePostReference(raw);
  const isFacebook = /(?:^|\/\/|\.)(?:facebook\.com|fb\.com|fb\.watch)\//i.test(raw) || raw.startsWith("pfbid");
  const needsFacebookLookup = !!extractPfbid(raw) || (isFacebook && !parsed);
  const needsInstagramLookup = parsed?.platform === "instagram";
  if (parsed && !needsFacebookLookup && !needsInstagramLookup) return { ok: true, postId: parsed.postId, platform: parsed.platform, resolvedVia: "parsed" };
  if (!parsed && !needsFacebookLookup) {
    return { ok: false, status: 400, error: "Couldn't read a post id from that. Paste the post's link (Share → Copy link) or its numeric id." };
  }
  const wanted = needsInstagramLookup ? "instagram" : "messenger";
  const accounts = (await listSocialAccounts(tenantId)).filter((a) => a.platform === wanted);
  for (const a of accounts) {
    const row = await getSocialAccountForSend(tenantId, a.id);
    const token = row ? await openToken(row.accessTokenSealed) : null;
    if (!token) continue;
    try {
      const found =
        wanted === "instagram"
          ? await resolveInstagramMediaId({ igUserId: a.externalId, token, reference: raw })
          : await resolveFacebookPostId({ pageId: a.pageId ?? a.externalId, pageToken: token, reference: raw });
      if (found) return { ok: true, postId: found.postId, platform: found.platform, resolvedVia: "graph" };
    } catch (error) {
      console.warn("[resolvePostReference] lookup failed", a.id, error instanceof Error ? error.message : error);
    }
  }
  if (needsInstagramLookup && parsed) {
    // Keep the shortcode so nothing is lost; it starts matching once Instagram is connected and the link is saved again.
    return { ok: true, postId: parsed.postId, platform: "instagram", resolvedVia: "parsed", notice: accounts.length ? "We couldn't find this post on your connected Instagram account yet — comments will be matched once it shows up. Re-save the link in a few minutes." : "Connect your Instagram account in Channels so comments on this post can be matched." };
  }
  return {
    ok: false,
    status: 422,
    error: accounts.length
      ? "We couldn't find that post on your connected Facebook Page(s). Make sure it was posted by the Page (not a personal profile), then try again — or paste the post's numeric id."
      : "Connect your Facebook Page in Channels first — newer Facebook links (pfbid…) can only be read through the Page.",
  };
}

// ─── 24/7 Taglish AI sales closer ─────────────────────────────────────────────

export type CloserOutcome = {
  status: "sent" | "skipped" | "failed" | "busy";
  reason?: string;
  servedBy?: string;
  escalated?: boolean;
  checkoutUrl?: string | null;
};

const TO_CHAT_METHOD: Record<string, ChatPaymentMethod> = { gcash: "gcash", paymaya: "maya", maya: "maya", qrph: "qrph", cod: "cod" };

function manilaDay(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** The four closer tools, bound to one shop + chat (the model never sees ids it could spoof). */
export function buildCloserTools(input: {
  tenantId: string;
  threadId: string;
  platform: SocialPlatform;
  buyerName: string | null;
  onEscalate: (reason: string) => Promise<void>;
}): CloserTools {
  const { tenantId, threadId, platform } = input;
  return {
    async check_product_inventory(args) {
      const id = typeof args.product_id === "string" && UUID.test(args.product_id) ? args.product_id : undefined;
      const text = typeof args.product_query === "string" ? args.product_query.slice(0, 120) : undefined;
      const found = await findChatInventory(tenantId, id ? { productId: id } : { text });
      if (!found.length) return { found: false, note: "No matching active product. Ask the buyer to describe it or escalate." };
      return {
        found: true,
        products: found.map((p) => ({
          product_id: p.productId,
          title: p.title,
          variants: p.variants.map((v) => ({
            variant_id: v.variantId,
            title: v.title,
            price: v.price,
            in_stock: v.inStock,
            // D5: exact counts only when the shop tracks stock — otherwise the AI may not state one.
            ...(v.stockLeft !== null ? { stock_left: v.stockLeft } : {}),
          })),
        })),
      };
    },
    async quote_bayango_delivery(args) {
      const shop = await getShopDeliveryContext(tenantId);
      if (!shop) return { ok: false, note: "Delivery isn't set up. Escalate for delivery questions." };
      const dropoff = [args.buyer_address, args.buyer_barangay_or_city].filter((s): s is string => typeof s === "string" && !!s.trim()).join(", ").slice(0, 240);
      const q = await quoteChatDelivery({
        pickupAddress: shop.pickupAddress,
        dropoff,
        subtotal: typeof args.subtotal === "number" ? args.subtotal : null,
        flatRate: shop.flatRate,
        freeDeliveryMin: shop.freeDeliveryMin,
      });
      await mergeThreadAiContext(tenantId, threadId, { buyerArea: dropoff });
      return { ok: true, provider: q.provider, fee: q.fee, eta_minutes: q.etaMinutes, live_quote: q.isLive, free: q.free, free_delivery_min: q.freeDeliveryMin };
    },
    async create_prefilled_checkout_link(args) {
      const items = (Array.isArray(args.items) ? args.items : [])
        .filter((i) => i && typeof i.product_id === "string" && UUID.test(i.product_id))
        .slice(0, 10)
        .map((i) => ({ productId: i.product_id, variantId: typeof i.variant_id === "string" && UUID.test(i.variant_id) ? i.variant_id : null, quantity: Number(i.quantity) || 1 }));
      if (!items.length) return { ok: false, reason: "invalid_items", message: "Check inventory first and use its product_id / variant_id." };
      const method = TO_CHAT_METHOD[String(args.payment_method)] ?? null;
      if (!method) return { ok: false, reason: "payment_unavailable", message: "Ask the buyer: GCash, Maya, QRPh or COD?", available_methods: await availableChatPaymentMethods(tenantId) };
      const b = args.buyer ?? {};
      const res = await createPrefilledChatCheckoutLink(tenantId, {
        threadId,
        items,
        paymentMethod: method,
        channel: platform,
        prefill: { name: b.name ?? input.buyerName ?? undefined, phone: b.phone, addressLine: b.address_line, barangay: b.barangay, city: b.city, landmark: b.landmark },
      });
      if (!res.ok) return { ok: false, reason: res.reason, message: res.message, ...(res.availableMethods ? { available_methods: res.availableMethods } : {}) };
      return { ok: true, code: res.code, url: checkoutLinkShareUrl(res.code, platform, threadId), payment_method: res.paymentMethod };
    },
    async escalate_to_human_seller(args) {
      const reason = String(args.reason ?? "Buyer needs the seller").slice(0, 300);
      await pauseThreadAi(tenantId, threadId, reason);
      await input.onEscalate(reason);
      return { ok: true, note: "AI paused on this chat; the seller has been alerted." };
    },
  };
}

/**
 * Answer the buyer's latest message(s) on one chat. Safe to call twice (webhook + cron sweep):
 * one run per chat at a time, and it only answers when the newest message is the buyer's.
 */
export async function runCloserForThread(tenantId: string, threadId: string, opts: { now?: Date; debounceMs?: number } = {}): Promise<CloserOutcome> {
  // Buyers often send 2–3 short messages in a row: wait a moment so one reply covers them all.
  if (opts.debounceMs) await new Promise((r) => setTimeout(r, opts.debounceMs));
  const res = await withCronLock(`closer:${threadId}`, () => runCloserLocked(tenantId, threadId, opts.now ?? new Date()), 120);
  return res ?? { status: "busy" };
}

async function runCloserLocked(tenantId: string, threadId: string, now: Date): Promise<CloserOutcome> {
  const ctx = await getCloserContext(tenantId, threadId);
  if (!ctx) return { status: "skipped", reason: "not_found" };
  if (!ctx.closerEnabled) return { status: "skipped", reason: "closer_off" };
  if (ctx.thread.aiPaused) return { status: "skipped", reason: "paused" };
  const last = ctx.messages[ctx.messages.length - 1];
  if (!last || last.direction !== "in") return { status: "skipped", reason: "nothing_to_answer" };
  if (ctx.messages.some((m) => m.direction === "out" && m.aiOrigin === null && now.getTime() - m.createdAt.getTime() < SELLER_ACTIVE_MS)) {
    return { status: "skipped", reason: "seller_active" };
  }

  const tier = getAiSuiteTier(ctx.shop.subscriptionPlan);
  const limit = PLAN_AI_LIMITS[tier.legacyFeaturePlan].chatMessagesPerDay;
  const cap = await rateLimit(`closer:${tenantId}:${manilaDay(now)}`, { limit, windowSeconds: 86_400 });
  if (!cap.allowed) {
    const once = await rateLimit(`closer-cap-alert:${tenantId}:${manilaDay(now)}`, { limit: 1, windowSeconds: 86_400 });
    if (once.allowed) {
      await notifySeller(tenantId, { title: "AI closer paused for today", body: `Your plan's ${limit} AI chat replies for today are used up. Buyers' messages are waiting in your inbox.`, url: "/inbox", tag: "closer-cap" });
    }
    return { status: "skipped", reason: "daily_cap" };
  }

  const platform = ctx.thread.platform;
  const [paymentMethods, usage] = await Promise.all([availableChatPaymentMethods(tenantId), getRawAiUsageCounts(tenantId).catch(() => null)]);
  const bridge = bridgeConfigFromEnv();
  let escalationReason: string | null = null;
  const tools = buildCloserTools({
    tenantId,
    threadId,
    platform,
    buyerName: ctx.thread.buyerName,
    onEscalate: async (reason) => {
      escalationReason = reason;
    },
  });

  const result = await runCloserTurn({
    ctx: { shopName: ctx.shop.name, paymentMethods, buyerName: ctx.thread.buyerName, platform, now },
    history: ctx.messages.map((m) => ({ direction: m.direction, body: m.body })),
    tools,
    primary: bridge ? bridgeCloserModel(bridge, tenantId) : null,
    fallback: () => cloudCloserModel({ plan: tier.legacyFeaturePlan, tokensUsedThisMonth: usage?.tokensThisMonth }),
    onFallback: (why, error) => {
      if (why !== "not_configured") console.warn(`[closer] ${threadId} → cloud (${why})`, error instanceof Error ? error.message : "");
    },
    linkUrl: (r) => r.url ?? (r.code ? checkoutLinkShareUrl(r.code, platform, threadId) : null),
  });

  let begun: Awaited<ReturnType<typeof beginSocialSend>>;
  try {
    begun = await beginSocialSend({
      tenantId,
      threadId,
      kind: result.checkoutUrl ? "link" : "text",
      body: result.reply,
      payload: { closer: { servedBy: result.servedBy, model: result.model, tools: result.toolLog.map((t) => t.name), guards: result.guards, escalated: result.escalated } },
      sentByName: AI_SENDER_NAME,
      aiOrigin: "auto",
      now,
    });
  } catch (error) {
    if (error instanceof InboxError) return { status: "skipped", reason: error.code === "WINDOW_CLOSED" ? "window_closed" : error.code.toLowerCase() };
    throw error;
  }
  const token = await openToken(ctx.account.accessTokenSealed);
  const sent = await sendSocialMessage({ platform, account: accountForSend(ctx.account), token, recipientId: ctx.thread.externalUserId, message: { type: "text", text: result.reply } });
  await finishSocialSend(tenantId, threadId, begun.messageId, { success: sent.success, externalMessageId: sent.messageId ?? null, mock: sent.mock, error: sent.error ?? null }, result.reply);
  if (result.tokens > 0) await recordAiUsage(tenantId, { tokensUsed: result.tokens });
  await mergeThreadAiContext(tenantId, threadId, { lastCloserAt: now.toISOString(), lastServedBy: result.servedBy });

  if (result.escalated) {
    // The step limit can escalate without the tool — make sure the chat is paused either way.
    if (!escalationReason) await pauseThreadAi(tenantId, threadId, "AI couldn't finish this one");
    await notifySeller(tenantId, {
      title: `${ctx.thread.buyerName ?? "A buyer"} needs you`,
      body: (escalationReason ?? "The AI handed this chat over to you.").slice(0, 120),
      url: `/inbox?t=${threadId}`,
      tag: `escalate-${threadId}`,
    });
  }
  return { status: sent.success ? "sent" : "failed", reason: sent.error, servedBy: result.servedBy, escalated: result.escalated, checkoutUrl: result.checkoutUrl };
}

// ─── Buttons the buyer taps ───────────────────────────────────────────────────

export function isCloserPostback(payload: string | null | undefined): boolean {
  return typeof payload === "string" && payload.startsWith(SWITCH_COD_PREFIX);
}

/** "Switch to COD" from a recovery nudge: same items, same details, a fresh COD link. */
export async function handleCloserPostback(input: { tenantId: string; threadId: string; payload: string }): Promise<CloserOutcome> {
  const linkId = input.payload.slice(SWITCH_COD_PREFIX.length);
  if (!UUID.test(linkId)) return { status: "skipped", reason: "bad_payload" };
  const ctx = await getCloserContext(input.tenantId, input.threadId);
  if (!ctx) return { status: "skipped", reason: "not_found" };
  const old = await getCheckoutLinkItemsForChat(input.tenantId, linkId);
  if (!old || !old.items.length) return { status: "skipped", reason: "link_not_found" };
  const methods = await availableChatPaymentMethods(input.tenantId);
  let reply: string;
  let url: string | null = null;
  if (!methods.includes("cod")) {
    reply = "Pasensya na po, hindi available ang COD sa shop na ito ngayon 🙏 Tutulungan ka po ng seller sa ibang payment option.";
    await pauseThreadAi(input.tenantId, input.threadId, "Buyer asked for COD (not available)");
  } else {
    const made = await createPrefilledChatCheckoutLink(input.tenantId, {
      threadId: input.threadId,
      items: old.items,
      paymentMethod: "cod",
      channel: ctx.thread.platform,
      prefill: { ...(old.prefill ?? {}), paymentMethod: undefined },
    });
    if (made.ok) {
      url = checkoutLinkShareUrl(made.code, ctx.thread.platform, input.threadId);
      reply = `Sige po! Cash on Delivery na tayo 😊 Naka-fill na ang details mo, i-confirm mo lang dito 👉 ${url}`;
    } else {
      reply = "Sige po! Ipapasa ko sa seller para ma-ayos ang COD order mo 😊";
      await pauseThreadAi(input.tenantId, input.threadId, `Switch to COD failed: ${made.message}`);
    }
  }
  const begun = await beginSocialSend({ tenantId: input.tenantId, threadId: input.threadId, kind: url ? "link" : "text", body: reply, sentByName: AI_SENDER_NAME, aiOrigin: "auto" });
  const token = await openToken(ctx.account.accessTokenSealed);
  const sent = await sendSocialMessage({ platform: ctx.thread.platform, account: accountForSend(ctx.account), token, recipientId: ctx.thread.externalUserId, message: { type: "text", text: reply } });
  await finishSocialSend(input.tenantId, input.threadId, begun.messageId, { success: sent.success, externalMessageId: sent.messageId ?? null, mock: sent.mock, error: sent.error ?? null }, reply);
  return { status: sent.success ? "sent" : "failed", checkoutUrl: url };
}

// ─── Abandoned cart & ghost buyers ────────────────────────────────────────────

export interface RecoveryRunResult {
  converted: number;
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
}

function bayangoConfigured(): boolean {
  return Boolean(process.env.BAYANGO_API_BASE_URL?.trim() && process.env.BAYANGO_API_KEY?.trim());
}

export async function nudgeOneCart(c: CartRecoveryCandidate, now = new Date()): Promise<"sent" | "skipped" | "failed" | "taken"> {
  const nudgeId = await claimCartNudge({ tenantId: c.tenantId, threadId: c.threadId, checkoutLinkId: c.linkId, channel: c.platform });
  if (!nudgeId) return "taken";
  try {
    const settings = await getTenantSettings(c.tenantId);
    if (!canAttachTrigger(settings?.subscriptionPlan)) {
      await finishCartNudge(c.tenantId, nudgeId, c.threadId, { status: "skipped", error: "plan" });
      return "skipped";
    }
    const account = await getSocialAccountForSend(c.tenantId, c.accountId);
    if (!account) {
      await finishCartNudge(c.tenantId, nudgeId, c.threadId, { status: "skipped", error: "account" });
      return "skipped";
    }
    const [methods, delivery] = await Promise.all([availableChatPaymentMethods(c.tenantId), getShopDeliveryContext(c.tenantId)]);
    const linkMethods = (c.linkPaymentMethods ?? []).map((m) => TO_CHAT_METHOD[m]).filter((m): m is ChatPaymentMethod => !!m);
    const input: NudgeInput = {
      buyerName: c.buyerName,
      itemTitle: c.linkTitle,
      shopName: c.shopName,
      stage: c.orderId ? "unpaid_order" : "no_order",
      currentMethod: linkMethods.length === 1 ? linkMethods[0]! : null,
      codAvailable: methods.includes("cod"),
      bayangoDelivery: bayangoConfigured() && !!delivery?.pickupAddress.trim(),
    };
    const nudge = await writeCartNudge(input, {
      personalised: c.closerEnabled,
      tenantId: c.tenantId,
      plan: getAiSuiteTier(settings?.subscriptionPlan).legacyFeaturePlan,
      bridge: bridgeConfigFromEnv(),
    });
    const base = storefrontBaseUrl.replace(/\/$/, "");
    const url = c.orderPath ? `${base}${c.orderPath}` : checkoutLinkShareUrl(c.linkCode, c.platform, c.threadId);
    // An unpaid order switches to COD by the seller (the order exists already); a ghost buyer gets a fresh COD link.
    const codButton = offerCodSwitch(input) && !c.orderId;
    const message: MetaOutgoing = {
      type: "buttons",
      text: nudge.text,
      buttons: [
        { kind: "url", title: c.orderId ? "Complete Payment" : "Finish my order", url },
        ...(codButton ? [{ kind: "postback" as const, title: "Switch to COD", payload: `${SWITCH_COD_PREFIX}${c.linkId}` }] : []),
      ],
    };
    let begun: Awaited<ReturnType<typeof beginSocialSend>>;
    try {
      begun = await beginSocialSend({
        tenantId: c.tenantId,
        threadId: c.threadId,
        kind: "link",
        body: `${nudge.text}\n👉 ${url}`,
        payload: { cartNudge: { linkId: c.linkId, stage: input.stage, servedBy: nudge.servedBy, codButton } },
        sentByName: AI_SENDER_NAME,
        aiOrigin: "auto",
        now,
      });
    } catch (error) {
      if (error instanceof InboxError) {
        await finishCartNudge(c.tenantId, nudgeId, c.threadId, { status: "skipped", error: error.code });
        return "skipped";
      }
      throw error;
    }
    const token = await openToken(account.accessTokenSealed);
    const sent = await sendSocialMessage({ platform: c.platform, account: accountForSend(account), token, recipientId: c.externalUserId, message });
    await finishSocialSend(c.tenantId, c.threadId, begun.messageId, { success: sent.success, externalMessageId: sent.messageId ?? null, mock: sent.mock, error: sent.error ?? null }, nudge.text);
    await finishCartNudge(c.tenantId, nudgeId, c.threadId, sent.success ? { status: "sent", body: nudge.text } : { status: "failed", body: nudge.text, error: sent.error ?? "send failed" });
    return sent.success ? "sent" : "failed";
  } catch (error) {
    console.error("[social-automation] nudge failed", error);
    await finishCartNudge(c.tenantId, nudgeId, c.threadId, { status: "failed", error: error instanceof Error ? error.message : "failed" }).catch(() => undefined);
    return "failed";
  }
}

export async function runCartRecovery(opts: { now?: Date; limit?: number; deadlineMs?: number } = {}): Promise<RecoveryRunResult> {
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.deadlineMs ?? 40_000);
  const converted = await markConvertedThreads();
  const candidates = await listCartRecoveryCandidates({ now, limit: opts.limit ?? 40 });
  const out: RecoveryRunResult = { converted, candidates: candidates.length, sent: 0, skipped: 0, failed: 0 };
  for (const c of candidates) {
    if (Date.now() > deadline) break;
    const r = await nudgeOneCart(c, now);
    if (r === "sent") out.sent += 1;
    else if (r === "failed") out.failed += 1;
    else out.skipped += 1;
  }
  return out;
}

/** Safety net: chats the webhook's background run didn't answer (crash, timeout, lock contention). */
export async function sweepUnansweredChats(opts: { deadlineMs?: number } = {}): Promise<{ checked: number; sent: number }> {
  const deadline = Date.now() + (opts.deadlineMs ?? 30_000);
  const rows = await listUnansweredCloserThreads();
  let sent = 0;
  for (const r of rows) {
    if (Date.now() > deadline) break;
    try {
      const res = await runCloserForThread(r.tenantId, r.threadId);
      if (res.status === "sent") sent += 1;
    } catch (error) {
      console.error("[social-automation] sweep failed", r.threadId, error);
    }
  }
  return { checked: rows.length, sent };
}
