import { parseReviewRating, reviewBodyFrom, reviewPhotoAckText, reviewPromptText, reviewThanksText } from "@gumakart/ai";
import { printairMockupPayloadSchema, type PrintairMockupPayload } from "@gumakart/ai/studio";
import {
  addReviewPromptPhotos,
  beginSocialSend,
  claimBroadcastBatches,
  completeReviewFromChat,
  createPrintairUpsell,
  enqueueAiMediaJob,
  expireReviewPrompts,
  fillBroadcastTemplate,
  findOpenReviewPrompt,
  finishBroadcastIfDone,
  finishSocialSend,
  getAiSuiteSettings,
  getShopDeliveryContext,
  getSocialAccountForSend,
  getTenantSettings,
  InboxError,
  isBroadcastActive,
  listDueReviewPrompts,
  listPrintairCandidates,
  listSocialAccounts,
  listTenantsForSegmentRefresh,
  markReviewPrompt,
  recordAutomatedMessage,
  recordBroadcastSend,
  refreshBuyerSegments,
  syncPrintairUpsells,
  type BroadcastBatch,
  type DueReviewPrompt,
  type PrintairCard,
  type SocialPlatform,
} from "@gumakart/db";
import { getAiSuiteTier } from "@gumakart/plans";
import {
  ecosystemJwtSecret,
  fetchMetaAttachment,
  fetchWhatsAppMedia,
  openToken,
  sendSocialMessage,
  sendWhatsAppTemplate,
  signEcosystemJwt,
} from "@gumakart/services";
import { productShareUrl, shopShareUrl } from "@/lib/channels";
import { canAttachTrigger } from "@/lib/marketing-studio";
import { saveReviewPhotoBytes } from "@/lib/product-uploads";
import { storefrontBaseUrl } from "@/lib/utils";

/**
 * AI Marketing Suite Phases 4 + 5 — the jobs and webhook hooks:
 *   runSegmentRefresh   nightly buyer CRM tags (VIP_REPEAT / PAYDAY_SHOPPER / INACTIVE_60D)
 *   runBroadcasts       payday / restock broadcasts at ≤ 10 msg/s, Meta-window / template compliant
 *   runReviewLoop       BayanGo review asks 2 h after delivery (+ expiry)
 *   handleReviewReply   the buyer's chat answer → verified review + single-use voucher
 *   runPrintairUpsells  branded-packaging mockups at shop milestones
 *   buildPrintairHandoff signed short-lived JWT → printair.guma.one/api/import-from-gumakart
 */

const BROADCAST_SENDER = "Guma broadcast";
const REVIEW_SENDER = "Guma AI review";

function sleep(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function base(): string {
  return storefrontBaseUrl.replace(/\/$/, "");
}

function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${base()}${url}`;
  return null;
}

function accountRef(a: { externalId: string; pageId: string | null; phoneNumberId?: string | null }) {
  return { externalId: a.externalId, pageId: a.pageId, phoneNumberId: a.phoneNumberId ?? null };
}

// ─── 4.1 Segments ─────────────────────────────────────────────────────────────

export async function runSegmentRefresh(opts: { deadlineMs?: number } = {}): Promise<{ shops: number; buyers: number; failed: number }> {
  const deadline = Date.now() + (opts.deadlineMs ?? 50_000);
  const shops = await listTenantsForSegmentRefresh();
  let buyers = 0;
  let failed = 0;
  let done = 0;
  for (const id of shops) {
    if (Date.now() > deadline) break;
    try {
      buyers += await refreshBuyerSegments(id);
      done += 1;
    } catch (error) {
      failed += 1;
      console.error("[segments] refresh failed", id, error);
    }
  }
  return { shops: done, buyers, failed };
}

// ─── 4.2 Broadcasts ───────────────────────────────────────────────────────────

/** The link each buyer gets: the restocked product, else "order again" from their last order, else the shop. */
export function broadcastLink(
  campaign: { kind: string; channel: SocialPlatform; shopSlug: string; productSlug?: string | null },
  r: { lastOrderId: string | null }
): string {
  if (campaign.kind === "restock" && campaign.productSlug) return productShareUrl(campaign.shopSlug, campaign.productSlug, campaign.channel);
  if (r.lastOrderId) return `${base()}/${campaign.shopSlug}/reorder/${r.lastOrderId}?ref=${campaign.channel}&utm_source=broadcast`;
  return shopShareUrl(campaign.shopSlug, campaign.channel);
}

async function productSlug(tenantId: string, productId: string | null): Promise<string | null> {
  if (!productId) return null;
  const { getDb, products } = await import("@gumakart/db");
  const { and, eq } = await import("drizzle-orm");
  const [p] = await getDb().select({ slug: products.slug }).from(products).where(and(eq(products.id, productId), eq(products.tenantId, tenantId))).limit(1);
  return p?.slug ?? null;
}

export interface BroadcastRunResult {
  campaigns: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Sends due broadcasts, paced at the campaign's rate (≤ 10 msg/s). Session messages go through the
 * inbox's send path (which re-checks Meta's 24 h window per buyer); WhatsApp buyers outside the
 * window get the approved template. Stops at the deadline; the next cron run picks up.
 */
export async function runBroadcasts(opts: { now?: Date; deadlineMs?: number; sleepFn?: (ms: number) => Promise<void> } = {}): Promise<BroadcastRunResult> {
  const deadline = Date.now() + (opts.deadlineMs ?? 45_000);
  const wait = opts.sleepFn ?? sleep;
  const out: BroadcastRunResult = { campaigns: 0, sent: 0, failed: 0, skipped: 0 };
  const batches = await claimBroadcastBatches(opts.now ?? new Date());
  for (const batch of batches) {
    if (Date.now() > deadline) break;
    out.campaigns += 1;
    const r = await sendBroadcastBatch(batch, { deadline, wait });
    out.sent += r.sent;
    out.failed += r.failed;
    out.skipped += r.skipped;
  }
  return out;
}

async function sendBroadcastBatch(batch: BroadcastBatch, ctx: { deadline: number; wait: (ms: number) => Promise<void> }) {
  const c = batch.campaign;
  const res = { sent: 0, failed: 0, skipped: 0 };
  const settings = await getTenantSettings(c.tenantId);
  if (!getAiSuiteTier(settings?.subscriptionPlan).broadcastEnabled) {
    // Plan no longer includes broadcasts: stop rather than send.
    for (const r of batch.recipients) await recordBroadcastSend(r.id, c.id, { status: "skipped", skipReason: "plan" });
    await finishBroadcastIfDone(c.id);
    return { ...res, skipped: batch.recipients.length };
  }
  const slug = await productSlug(c.tenantId, c.productId);
  const accounts = (await listSocialAccounts(c.tenantId)).filter((a) => a.platform === c.channel && a.status !== "disconnected");
  const waAccount = c.channel === "whatsapp" && accounts[0] ? await getSocialAccountForSend(c.tenantId, accounts[0].id) : null;
  const tokens = new Map<string, string | null>();
  const tokenFor = async (accountId: string, sealed: string | null) => {
    if (!tokens.has(accountId)) tokens.set(accountId, await openToken(sealed));
    return tokens.get(accountId) ?? null;
  };
  const gapMs = Math.ceil(1000 / Math.max(1, Math.min(10, c.rateLimitPerSec)));

  for (const r of batch.recipients) {
    if (Date.now() > ctx.deadline) break;
    if (!(await isBroadcastActive(c.id))) break; // cancelled mid-send
    const started = Date.now();
    const link = broadcastLink({ kind: c.kind, channel: c.channel, shopSlug: c.shopSlug, productSlug: slug }, { lastOrderId: r.lastOrderId });
    const body = fillBroadcastTemplate(c.messageTemplate, { name: r.name, item: r.lastItem, link, shop: c.shopName });
    try {
      if (r.mode === "session" && r.threadId) {
        let begun: Awaited<ReturnType<typeof beginSocialSend>>;
        try {
          begun = await beginSocialSend({ tenantId: c.tenantId, threadId: r.threadId, kind: "link", body, sentByName: BROADCAST_SENDER, aiOrigin: "auto", payload: { broadcast: { campaignId: c.id } } });
        } catch (error) {
          if (error instanceof InboxError) {
            // The buyer's window closed since the broadcast was queued.
            await recordBroadcastSend(r.id, c.id, { status: "skipped", skipReason: error.code === "WINDOW_CLOSED" ? "outside_24h" : error.code.toLowerCase() });
            res.skipped += 1;
            continue;
          }
          throw error;
        }
        const thread = await threadAccount(c.tenantId, r.threadId);
        const account = thread ? await getSocialAccountForSend(c.tenantId, thread.accountId) : null;
        if (!thread || !account) {
          await finishSocialSend(c.tenantId, r.threadId, begun.messageId, { success: false, error: "Account disconnected" }, body);
          await recordBroadcastSend(r.id, c.id, { status: "failed", body, error: "Account disconnected" });
          res.failed += 1;
          continue;
        }
        const sent = await sendSocialMessage({
          platform: c.channel,
          account: accountRef(account),
          token: await tokenFor(account.id, account.accessTokenSealed),
          recipientId: thread.externalUserId,
          message: { type: "text", text: body },
        });
        await finishSocialSend(c.tenantId, r.threadId, begun.messageId, { success: sent.success, externalMessageId: sent.messageId ?? null, mock: sent.mock, error: sent.error ?? null }, body);
        await recordBroadcastSend(r.id, c.id, sent.success ? { status: "sent", body } : { status: "failed", body, error: sent.error ?? "send failed" });
        if (sent.success) res.sent += 1;
        else res.failed += 1;
      } else if (r.mode === "template" && c.waTemplateName && waAccount && r.recipientId) {
        // Approved template: fixed wording (Meta-approved), {{1}} = first name, {{2}} = link.
        const first = (r.name ?? "").trim().split(/\s+/)[0] || "Suki";
        const sent = await sendWhatsAppTemplate({
          phoneNumberId: waAccount.phoneNumberId ?? waAccount.externalId,
          token: await tokenFor(waAccount.id, waAccount.accessTokenSealed),
          to: r.recipientId,
          templateName: c.waTemplateName,
          language: c.waTemplateLanguage,
          bodyParams: [first, link],
        });
        const tplBody = `[WhatsApp template "${c.waTemplateName}"] ${first} · ${link}`;
        if (sent.success && r.threadId) {
          await recordAutomatedMessage({ tenantId: c.tenantId, threadId: r.threadId, kind: "link", body: tplBody, payload: { broadcast: { campaignId: c.id, template: c.waTemplateName } }, externalMessageId: sent.messageId ?? null, status: sent.mock ? "mock" : "sent", sentByName: BROADCAST_SENDER });
        }
        await recordBroadcastSend(r.id, c.id, sent.success ? { status: "sent", body: tplBody } : { status: "failed", body: tplBody, error: sent.error ?? "send failed" });
        if (sent.success) res.sent += 1;
        else res.failed += 1;
      } else {
        await recordBroadcastSend(r.id, c.id, { status: "skipped", skipReason: r.mode === "template" ? "needs_template" : "unreachable" });
        res.skipped += 1;
        continue;
      }
    } catch (error) {
      console.error("[broadcast] send failed", c.id, r.id, error);
      await recordBroadcastSend(r.id, c.id, { status: "failed", body, error: error instanceof Error ? error.message : "failed" });
      res.failed += 1;
    }
    const spent = Date.now() - started;
    if (spent < gapMs) await ctx.wait(gapMs - spent);
  }
  await finishBroadcastIfDone(c.id);
  return res;
}

async function threadAccount(tenantId: string, threadId: string): Promise<{ accountId: string; externalUserId: string } | null> {
  const { getDb, socialThreads } = await import("@gumakart/db");
  const { and, eq } = await import("drizzle-orm");
  const [t] = await getDb()
    .select({ accountId: socialThreads.accountId, externalUserId: socialThreads.externalUserId })
    .from(socialThreads)
    .where(and(eq(socialThreads.id, threadId), eq(socialThreads.tenantId, tenantId)))
    .limit(1);
  return t ?? null;
}

// ─── 4.3 BayanGo review loop ──────────────────────────────────────────────────

export function reviewPageUrl(p: { shopSlug: string; orderNumber: string; accessToken: string | null }): string | null {
  return p.accessToken ? `${base()}/${p.shopSlug}/orders/${encodeURIComponent(p.orderNumber)}?t=${p.accessToken}#review` : null;
}

export async function sendReviewPrompt(p: DueReviewPrompt, now = new Date()): Promise<"sent" | "skipped" | "failed"> {
  const settings = await getAiSuiteSettings(p.tenantId);
  if (!settings.reviewLoopEnabled) {
    await markReviewPrompt(p.id, { status: "skipped", skipReason: "disabled" });
    return "skipped";
  }
  if (!canAttachTrigger(p.plan)) {
    await markReviewPrompt(p.id, { status: "skipped", skipReason: "plan" });
    return "skipped";
  }
  if (!p.thread) {
    // No chat with this buyer — the shop's SMS review-request recipe (if on) covers them.
    await markReviewPrompt(p.id, { status: "skipped", skipReason: "no_chat" });
    return "skipped";
  }
  const account = await getSocialAccountForSend(p.tenantId, p.thread.accountId);
  if (!account) {
    await markReviewPrompt(p.id, { status: "skipped", skipReason: "account" });
    return "skipped";
  }
  const token = await openToken(account.accessTokenSealed);
  const url = reviewPageUrl(p);
  const text = reviewPromptText({ buyerName: p.buyerName, shopName: p.shopName, item: p.firstItem, reviewUrl: url });
  const inWindow = !!p.thread.lastInboundAt && now.getTime() - p.thread.lastInboundAt.getTime() < 24 * 3_600_000;
  try {
    if (inWindow) {
      const begun = await beginSocialSend({ tenantId: p.tenantId, threadId: p.thread.id, kind: "text", body: text, sentByName: REVIEW_SENDER, aiOrigin: "auto", payload: { reviewPrompt: { id: p.id } }, now });
      const sent = await sendSocialMessage({ platform: p.thread.platform, account: accountRef(account), token, recipientId: p.thread.externalUserId, message: { type: "text", text } });
      await finishSocialSend(p.tenantId, p.thread.id, begun.messageId, { success: sent.success, externalMessageId: sent.messageId ?? null, mock: sent.mock, error: sent.error ?? null }, text);
      await markReviewPrompt(p.id, sent.success ? { status: "sent", threadId: p.thread.id, channel: p.thread.platform } : { status: "failed", error: sent.error ?? "send failed" });
      return sent.success ? "sent" : "failed";
    }
    if (p.thread.platform === "whatsapp" && settings.waReviewTemplate) {
      // Outside the window: an approved Utility template — {{1}} name, {{2}} shop, {{3}} review link.
      const first = (p.buyerName ?? "").trim().split(/\s+/)[0] || "Suki";
      const sent = await sendWhatsAppTemplate({
        phoneNumberId: account.phoneNumberId ?? account.externalId,
        token,
        to: p.thread.externalUserId,
        templateName: settings.waReviewTemplate,
        language: settings.waTemplateLanguage,
        bodyParams: [first, p.shopName, url ?? `${base()}/${p.shopSlug}`],
      });
      if (sent.success) {
        await recordAutomatedMessage({ tenantId: p.tenantId, threadId: p.thread.id, kind: "text", body: `[WhatsApp template "${settings.waReviewTemplate}"] review request`, payload: { reviewPrompt: { id: p.id } }, externalMessageId: sent.messageId ?? null, status: sent.mock ? "mock" : "sent", sentByName: REVIEW_SENDER });
      }
      await markReviewPrompt(p.id, sent.success ? { status: "sent", threadId: p.thread.id, channel: "whatsapp" } : { status: "failed", error: sent.error ?? "send failed" });
      return sent.success ? "sent" : "failed";
    }
    // Meta doesn't allow a business-initiated Messenger / IG message outside 24 h.
    await markReviewPrompt(p.id, { status: "skipped", skipReason: "outside_24h" });
    return "skipped";
  } catch (error) {
    if (error instanceof InboxError) {
      await markReviewPrompt(p.id, { status: "skipped", skipReason: error.code.toLowerCase() });
      return "skipped";
    }
    await markReviewPrompt(p.id, { status: "failed", error: error instanceof Error ? error.message : "failed" });
    return "failed";
  }
}

export async function runReviewLoop(opts: { now?: Date; deadlineMs?: number } = {}): Promise<{ due: number; sent: number; skipped: number; failed: number; expired: number }> {
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.deadlineMs ?? 40_000);
  const expired = await expireReviewPrompts(now);
  const due = await listDueReviewPrompts(now);
  const out = { due: due.length, sent: 0, skipped: 0, failed: 0, expired };
  for (const p of due) {
    if (Date.now() > deadline) break;
    const r = await sendReviewPrompt(p, now);
    out[r] += 1;
  }
  return out;
}

export interface InboundForReview {
  tenantId: string;
  threadId: string;
  accountId: string;
  platform: SocialPlatform;
  recipientId: string;
  text: string;
  /** Messenger / IG attachment URLs (Meta CDN). */
  attachmentUrls?: string[];
  /** WhatsApp photo media id. */
  waMediaId?: string | null;
}

/**
 * If this chat is waiting on a review answer, take it: stars → publish the verified review +
 * voucher; a photo alone → keep it and ask for the stars. Returns false when the message isn't
 * about the review (it then goes to the AI closer as usual).
 */
export async function handleReviewReply(m: InboundForReview, now = new Date()): Promise<boolean> {
  const prompt = await findOpenReviewPrompt(m.tenantId, m.threadId, now);
  if (!prompt) return false;
  const rating = parseReviewRating(m.text);
  const account = await getSocialAccountForSend(m.tenantId, m.accountId);
  const token = account ? await openToken(account.accessTokenSealed) : null;

  const photos: string[] = [];
  const downloads = [
    ...(m.attachmentUrls ?? []).slice(0, 4).map((u) => () => fetchMetaAttachment(u)),
    ...(m.waMediaId && token ? [() => fetchWhatsAppMedia(m.waMediaId!, token)] : []),
  ];
  for (const dl of downloads) {
    const file = await dl();
    const saved = file ? await saveReviewPhotoBytes(m.tenantId, file.bytes).catch(() => null) : null;
    if (saved) photos.push(absoluteUrl(saved.url) ?? saved.url);
  }
  if (rating === null && !photos.length) return false;

  let reply: string;
  if (rating === null) {
    await addReviewPromptPhotos(m.tenantId, prompt.id, photos);
    reply = reviewPhotoAckText();
  } else {
    const done = await completeReviewFromChat(m.tenantId, prompt.id, { rating, body: reviewBodyFrom(m.text), photos }, now);
    if (done.status !== "reviewed") return done.status === "already";
    const settings = await getTenantSettings(m.tenantId);
    reply = reviewThanksText({ rating, voucher: done.voucher, shopName: settings?.name ?? "the shop" });
  }
  if (account) {
    try {
      const begun = await beginSocialSend({ tenantId: m.tenantId, threadId: m.threadId, kind: "text", body: reply, sentByName: REVIEW_SENDER, aiOrigin: "auto", now });
      const sent = await sendSocialMessage({ platform: m.platform, account: accountRef(account), token, recipientId: m.recipientId, message: { type: "text", text: reply } });
      await finishSocialSend(m.tenantId, m.threadId, begun.messageId, { success: sent.success, externalMessageId: sent.messageId ?? null, mock: sent.mock, error: sent.error ?? null }, reply);
    } catch (error) {
      console.error("[review-loop] reply failed", error);
    }
  }
  return true;
}

// ─── 5.1 Printair mockups ─────────────────────────────────────────────────────

export async function runPrintairUpsells(opts: { limit?: number } = {}): Promise<{ synced: number; queued: number; failed: number }> {
  const synced = await syncPrintairUpsells();
  const candidates = await listPrintairCandidates(opts.limit ?? 25);
  let queued = 0;
  let failed = 0;
  for (const c of candidates) {
    const payload: PrintairMockupPayload = printairMockupPayloadSchema.parse({
      shopName: c.shopName.slice(0, 80),
      storeUrl: `${base()}/${c.slug}`,
      logoUrl: absoluteUrl(c.logoUrl),
      brandColor: c.brandColor && /^#?[0-9a-fA-F]{6}$/.test(c.brandColor) ? c.brandColor : null,
      tagline: c.tagline?.slice(0, 80) ?? null,
      milestone: c.milestone,
    });
    const job = await enqueueAiMediaJob({ tenantId: c.tenantId, jobType: "printair_mockup", inputPayload: payload, idempotencyKey: `printair:${c.milestone}` });
    if (job.ok) {
      if (await createPrintairUpsell(c.tenantId, c.milestone, job.job.id)) queued += 1;
    } else {
      failed += 1;
      await createPrintairUpsell(c.tenantId, c.milestone, null);
    }
  }
  return { synced, queued, failed };
}

export const PRINTAIR_IMPORT_URL = () => `${(process.env.PRINTAIR_BASE_URL?.trim() || "https://printair.guma.one").replace(/\/$/, "")}/api/import-from-gumakart`;

/**
 * The "Order on Printair" handoff: a 5-minute HS256 JWT (GUMA_ECOSYSTEM_JWT_SECRET) with the shop,
 * its brand assets, the mockups / print-ready PDF and the shipping address, so the seller lands on
 * Printair checkout with nothing to re-upload.
 */
export async function buildPrintairHandoff(
  tenantId: string,
  card: PrintairCard,
  seller: { email?: string | null; name?: string | null }
): Promise<{ ok: true; url: string; expiresAt: Date } | { ok: false; error: string }> {
  const secret = ecosystemJwtSecret();
  if (!secret) return { ok: false, error: "Printair ordering isn't set up yet (GUMA_ECOSYSTEM_JWT_SECRET)." };
  const settings = await getTenantSettings(tenantId);
  if (!settings) return { ok: false, error: "Shop not found." };
  const delivery = await getShopDeliveryContext(tenantId);
  const { getDb, tenants } = await import("@gumakart/db");
  const { eq } = await import("drizzle-orm");
  const [t] = await getDb().select({ logoUrl: tenants.logoUrl, theme: tenants.themePublishedJson, themeFallback: tenants.themeJson }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const theme = t?.theme ?? t?.themeFallback ?? null;
  const outputs = card.outputs;
  const pdf = outputs.find((o) => o.contentType === "application/pdf");
  const { token, expiresAt } = await signEcosystemJwt(
    {
      iss: "gumakart",
      aud: "printair",
      sub: tenantId,
      merchant_id: tenantId,
      tenant_id: tenantId,
      shop: { name: settings.name, slug: settings.slug, url: `${base()}/${settings.slug}` },
      seller: { email: seller.email ?? null, name: seller.name ?? null },
      brand_assets: {
        logo_url: absoluteUrl(t?.logoUrl),
        brand_color: theme?.primaryColor ?? null,
        accent_color: theme?.accentColor ?? null,
        qr_url: `${base()}/${settings.slug}`,
      },
      mockups: outputs.filter((o) => o.kind === "image").map((o) => ({ url: o.url, variant: o.variant ?? null })),
      print_ready_pdf_url: pdf?.url ?? null,
      shipping_address: delivery?.pickupAddress?.trim() ? { line: delivery.pickupAddress.trim(), country: "PH" } : null,
      milestone: card.milestone,
      upsell_id: card.id,
    },
    secret,
    { ttlSeconds: 300 }
  );
  return { ok: true, url: `${PRINTAIR_IMPORT_URL()}?token=${encodeURIComponent(token)}`, expiresAt };
}

