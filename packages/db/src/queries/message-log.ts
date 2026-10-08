import { and, count, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import { messageLog, messagingOptOuts, type MessageChannel } from "../schema/index";

/**
 * Every outbound message goes through sendWithLog(): it reserves a
 * message_log row keyed by `${recipe}:${entityId}:${step}` FIRST, so a retried
 * request or a replayed event can never text the buyer twice, then records
 * what the provider said.
 *
 * Kept provider-agnostic (the caller passes the actual send function) so this
 * package doesn't depend on @gumakart/services.
 */

export interface MessageEntry {
  tenantId: string | null;
  orderId?: string | null;
  customerId?: string | null;
  channel: MessageChannel;
  recipient: string;
  /** e.g. "order_created", "seller_payment_received" */
  recipe: string;
  step?: number;
  /** What the idempotency key is about — usually the order id. */
  entityId: string;
  body: string;
  provider?: string;
  /** Marketing messages (recovery, reminders) honour STOP; order updates don't (decision D2). */
  kind?: "transactional" | "marketing";
}

export interface ProviderSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  mock?: boolean;
}

export type SendWithLogResult =
  | { status: "sent"; messageId?: string; logId: string }
  | { status: "duplicate" }
  | { status: "suppressed"; reason: string; logId: string }
  | { status: "failed"; error: string; logId: string };

export function messageIdempotencyKey(recipe: string, entityId: string, step = 0): string {
  return `${recipe}:${entityId}:${step}`;
}

/** Same normalization the SMS client uses (PH numbers): digits only, 0-prefixed. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length === 12) return `0${digits.slice(2)}`;
  return digits;
}

function segmentsOf(body: string): number {
  // GSM-7 single 160 / multipart 153; anything outside ASCII → UCS-2 70 / 67.
  // eslint-disable-next-line no-control-regex
  const unicode = /[^\x00-\x7F]/.test(body);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return body.length <= single ? 1 : Math.ceil(body.length / multi);
}

export async function isOptedOut(
  phone: string,
  options: { channel?: MessageChannel; kind: "transactional" | "marketing"; tenantId?: string | null }
): Promise<boolean> {
  const db = getDb();
  const scopes = options.kind === "marketing" ? ["marketing", "all"] : ["all"];
  const [row] = await db
    .select({ id: messagingOptOuts.id })
    .from(messagingOptOuts)
    .where(
      and(
        eq(messagingOptOuts.phone, normalizePhone(phone)),
        eq(messagingOptOuts.channel, options.channel ?? "sms"),
        sql`${messagingOptOuts.scope} in (${sql.join(scopes.map((s) => sql`${s}`), sql`, `)})`,
        options.tenantId
          ? or(isNull(messagingOptOuts.tenantId), eq(messagingOptOuts.tenantId, options.tenantId))
          : isNull(messagingOptOuts.tenantId)
      )
    )
    .limit(1);
  return Boolean(row);
}

/** STOP / admin opt-out. Platform-wide by default (decision D3). */
export async function addOptOut(input: {
  phone: string;
  channel?: MessageChannel;
  scope?: "marketing" | "all";
  tenantId?: string | null;
  source?: "STOP" | "admin";
}): Promise<void> {
  const db = getDb();
  await db
    .insert(messagingOptOuts)
    .values({
      phone: normalizePhone(input.phone),
      channel: input.channel ?? "sms",
      scope: input.scope ?? "marketing",
      tenantId: input.tenantId ?? null,
      source: input.source ?? "STOP",
    })
    .onConflictDoNothing();
}

/** Per-number ceilings for 24 hours, platform-wide (GK-7). */
export const SMS_DAILY_CAP_MARKETING = 3;
export const SMS_DAILY_CAP_TRANSACTIONAL = 15;

export async function sendWithLog(
  entry: MessageEntry,
  send: () => Promise<ProviderSendResult>
): Promise<SendWithLogResult> {
  const db = getDb();
  const idempotencyKey = messageIdempotencyKey(entry.recipe, entry.entityId, entry.step ?? 0);

  // Buyers can't reply STOP to a sender name, so every reminder must carry the
  // signed "Stop reminders" link (withOptOutFooter in @gumakart/services).
  if (entry.kind === "marketing" && entry.channel === "sms" && !/\/stop\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(entry.body)) {
    throw new Error(`Marketing SMS "${entry.recipe}" has no opt-out link — use withOptOutFooter().`);
  }

  const [reserved] = await db
    .insert(messageLog)
    .values({
      tenantId: entry.tenantId,
      orderId: entry.orderId ?? null,
      customerId: entry.customerId ?? null,
      channel: entry.channel,
      recipient: entry.channel === "sms" ? normalizePhone(entry.recipient) : entry.recipient,
      recipe: entry.recipe,
      step: entry.step ?? 0,
      idempotencyKey,
      status: "queued",
      provider: entry.provider ?? null,
      body: entry.body,
      segments: entry.channel === "sms" ? segmentsOf(entry.body) : null,
    })
    .onConflictDoNothing({ target: messageLog.idempotencyKey })
    .returning({ id: messageLog.id });
  if (!reserved) return { status: "duplicate" };

  if (
    entry.channel === "sms" &&
    (await isOptedOut(entry.recipient, { kind: entry.kind ?? "transactional", tenantId: entry.tenantId }))
  ) {
    await db
      .update(messageLog)
      .set({ status: "suppressed", suppressedReason: "opted_out" })
      .where(eq(messageLog.id, reserved.id));
    return { status: "suppressed", reason: "opted_out", logId: reserved.id };
  }

  // Security G1 (GK-7): a hard ceiling per phone number per day across every shop, so no
  // combination of carts, alerts and orders can turn the platform into an SMS cannon aimed
  // at one person. Marketing is capped tighter than order updates.
  if (entry.channel === "sms") {
    const cap = entry.kind === "marketing" ? SMS_DAILY_CAP_MARKETING : SMS_DAILY_CAP_TRANSACTIONAL;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [{ n }] = await db
      .select({ n: count() })
      .from(messageLog)
      .where(
        and(
          eq(messageLog.channel, "sms"),
          eq(messageLog.recipient, normalizePhone(entry.recipient)),
          inArray(messageLog.status, ["queued", "sent", "delivered"]),
          gte(messageLog.createdAt, since),
          ne(messageLog.id, reserved.id)
        )
      );
    if (Number(n) >= cap) {
      await db
        .update(messageLog)
        .set({ status: "suppressed", suppressedReason: "daily_cap" })
        .where(eq(messageLog.id, reserved.id));
      return { status: "suppressed", reason: "daily_cap", logId: reserved.id };
    }
  }

  try {
    const result = await send();
    if (result.success) {
      await db
        .update(messageLog)
        .set({
          status: "sent",
          sentAt: new Date(),
          providerMessageId: result.messageId ?? null,
          error: result.mock ? "mock send (no provider credentials)" : null,
        })
        .where(eq(messageLog.id, reserved.id));
      return { status: "sent", messageId: result.messageId, logId: reserved.id };
    }
    const error = result.error ?? "Provider reported failure";
    await db
      .update(messageLog)
      .set({ status: "failed", error })
      .where(eq(messageLog.id, reserved.id));
    return { status: "failed", error, logId: reserved.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db
      .update(messageLog)
      .set({ status: "failed", error: error.slice(0, 2000) })
      .where(eq(messageLog.id, reserved.id));
    return { status: "failed", error, logId: reserved.id };
  }
}

export interface OptOutItem {
  id: string;
  phone: string;
  channel: string;
  scope: string;
  tenantId: string | null;
  source: string;
  createdAt: Date;
}

export async function listOptOuts(limit = 200): Promise<OptOutItem[]> {
  const db = getDb();
  return db
    .select({
      id: messagingOptOuts.id,
      phone: messagingOptOuts.phone,
      channel: messagingOptOuts.channel,
      scope: messagingOptOuts.scope,
      tenantId: messagingOptOuts.tenantId,
      source: messagingOptOuts.source,
      createdAt: messagingOptOuts.createdAt,
    })
    .from(messagingOptOuts)
    .orderBy(desc(messagingOptOuts.createdAt))
    .limit(limit);
}

/** Support undo (buyer asked to get reminders again). */
export async function removeOptOut(id: string): Promise<void> {
  const db = getDb();
  await db.delete(messagingOptOuts).where(eq(messagingOptOuts.id, id));
}

export interface PlatformMessageItem {
  id: string;
  tenantId: string | null;
  orderId: string | null;
  channel: string;
  recipient: string;
  recipe: string;
  status: string;
  error: string | null;
  createdAt: Date;
}

/** Ops view: recent sends, optionally only failures. Recipients are masked for display by the caller. */
export async function listRecentMessages(options: { failedOnly?: boolean; limit?: number } = {}): Promise<PlatformMessageItem[]> {
  const db = getDb();
  return db
    .select({
      id: messageLog.id,
      tenantId: messageLog.tenantId,
      orderId: messageLog.orderId,
      channel: messageLog.channel,
      recipient: messageLog.recipient,
      recipe: messageLog.recipe,
      status: messageLog.status,
      error: messageLog.error,
      createdAt: messageLog.createdAt,
    })
    .from(messageLog)
    .where(options.failedOnly ? eq(messageLog.status, "failed") : undefined)
    .orderBy(desc(messageLog.createdAt))
    .limit(Math.min(options.limit ?? 100, 500));
}

export interface MessageLogItem {
  id: string;
  channel: string;
  recipient: string;
  recipe: string;
  status: string;
  error: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

/** Recent sends for an order (admin order detail / support). */
export async function listMessagesForOrder(tenantId: string, orderId: string): Promise<MessageLogItem[]> {
  const db = getDb();
  return db
    .select({
      id: messageLog.id,
      channel: messageLog.channel,
      recipient: messageLog.recipient,
      recipe: messageLog.recipe,
      status: messageLog.status,
      error: messageLog.error,
      createdAt: messageLog.createdAt,
      sentAt: messageLog.sentAt,
    })
    .from(messageLog)
    .where(and(eq(messageLog.tenantId, tenantId), eq(messageLog.orderId, orderId)))
    .orderBy(messageLog.createdAt);
}
