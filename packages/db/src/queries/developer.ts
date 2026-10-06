import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "../client";
import { apiTokens, tenants, webhookDeliveries, webhookEndpoints, webhookEvents } from "../schema/index";
import {
  MAX_API_TOKENS,
  MAX_WEBHOOK_ENDPOINTS,
  WEBHOOK_DISABLE_AFTER,
  nextWebhookAttempt,
  normalizeEvents,
  normalizeScopes,
  type ApiScope,
  type WebhookEventName,
} from "../types/developer";
import { apiCustomersByIds,
  apiProductsByIds, apiOrdersByIds, apiVariantsByIds } from "./public-api";

/**
 * Phase 15 — API keys and webhooks.
 *
 * API keys: `gk_live_<43 chars>`. Only the SHA-256 is stored; the key is shown once.
 * Webhooks: DB triggers (migration 0033) write `webhook_events` in the same transaction as
 * the change. The cron fans each event out to the shop's subscribed endpoints (freezing one
 * payload), then sends due deliveries with retries (types/developer WEBHOOK_RETRY_MINUTES).
 */

export class PlatformError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "LIMIT" | "INVALID",
    message: string
  ) {
    super(message);
  }
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomSecret(prefix: string, bytes = 32): string {
  return `${prefix}${b64url(crypto.getRandomValues(new Uint8Array(bytes)))}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── API keys ────────────────────────────────────────────────────────────────

export interface ApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdByName: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

function tokenRow(r: typeof apiTokens.$inferSelect): ApiTokenRow {
  return {
    id: r.id,
    name: r.name,
    prefix: r.tokenPrefix,
    scopes: normalizeScopes(r.scopes),
    createdByName: r.createdByName,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
  };
}

export async function listApiTokens(tenantId: string): Promise<ApiTokenRow[]> {
  const rows = await getDb()
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tenantId, tenantId))
    .orderBy(sql`${apiTokens.revokedAt} is not null`, desc(apiTokens.createdAt));
  return rows.map(tokenRow);
}

export async function createApiToken(input: {
  tenantId: string;
  name: string;
  scopes: string[];
  expiresInDays?: number | null;
  createdByName: string;
  now?: Date;
}): Promise<{ token: string; row: ApiTokenRow }> {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new PlatformError("INVALID", "Give the key a name, like \"Accounting sync\".");
  const scopes = normalizeScopes(input.scopes);
  if (scopes.length === 0) throw new PlatformError("INVALID", "Pick at least one permission.");
  const db = getDb();
  const [{ live } = { live: 0 }] = await db
    .select({ live: sql<number>`count(*)::int` })
    .from(apiTokens)
    .where(and(eq(apiTokens.tenantId, input.tenantId), isNull(apiTokens.revokedAt)));
  if (live >= MAX_API_TOKENS) throw new PlatformError("LIMIT", `You can have up to ${MAX_API_TOKENS} active keys. Revoke one first.`);
  const now = input.now ?? new Date();
  const days = input.expiresInDays ?? null;
  const token = randomSecret("gk_live_");
  const [row] = await db
    .insert(apiTokens)
    .values({
      tenantId: input.tenantId,
      name,
      tokenPrefix: token.slice(0, 14),
      tokenHash: await sha256Hex(token),
      scopes,
      createdByName: input.createdByName.slice(0, 80),
      expiresAt: days ? new Date(now.getTime() + days * 86_400_000) : null,
    })
    .returning();
  return { token, row: tokenRow(row!) };
}

export async function revokeApiToken(tenantId: string, id: string): Promise<ApiTokenRow> {
  const [row] = await getDb()
    .update(apiTokens)
    .set({ revokedAt: sql`coalesce(${apiTokens.revokedAt}, now())` })
    .where(and(eq(apiTokens.tenantId, tenantId), eq(apiTokens.id, id)))
    .returning();
  if (!row) throw new PlatformError("NOT_FOUND", "That key doesn't exist.");
  return tokenRow(row);
}

export interface ApiPrincipal {
  tokenId: string;
  tokenName: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  scopes: ApiScope[];
}

/** Null for unknown, revoked or expired keys, or a shop that isn't active. */
export async function authenticateApiToken(raw: string | null | undefined, now = new Date()): Promise<ApiPrincipal | null> {
  const token = raw?.trim() ?? "";
  if (!/^gk_live_[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const db = getDb();
  const [row] = await db
    .select({ t: apiTokens, slug: tenants.slug, shopName: tenants.name, status: tenants.status })
    .from(apiTokens)
    .innerJoin(tenants, eq(tenants.id, apiTokens.tenantId))
    .where(eq(apiTokens.tokenHash, await sha256Hex(token)))
    .limit(1);
  if (!row || row.t.revokedAt || (row.t.expiresAt && row.t.expiresAt <= now) || row.status !== "active") return null;
  if (!row.t.lastUsedAt || now.getTime() - row.t.lastUsedAt.getTime() > 60_000) {
    await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.t.id));
  }
  return {
    tokenId: row.t.id,
    tokenName: row.t.name,
    tenantId: row.t.tenantId,
    tenantSlug: row.slug,
    tenantName: row.shopName,
    scopes: normalizeScopes(row.t.scopes),
  };
}

// ─── Webhook endpoints ───────────────────────────────────────────────────────

export interface WebhookEndpointRow {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEventName[];
  active: boolean;
  consecutiveFailures: number;
  disabledReason: string | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
  stats: { succeeded24h: number; failed24h: number; pending: number };
}

export async function listWebhookEndpoints(tenantId: string): Promise<WebhookEndpointRow[]> {
  const db = getDb();
  const rows = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.tenantId, tenantId)).orderBy(asc(webhookEndpoints.createdAt));
  if (rows.length === 0) return [];
  const stats = await db
    .select({
      endpointId: webhookDeliveries.endpointId,
      ok: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'succeeded' and ${webhookDeliveries.deliveredAt} > now() - interval '24 hours')::int`,
      bad: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'failed' and ${webhookDeliveries.createdAt} > now() - interval '24 hours')::int`,
      pending: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'pending')::int`,
    })
    .from(webhookDeliveries)
    .where(inArray(webhookDeliveries.endpointId, rows.map((r) => r.id)))
    .groupBy(webhookDeliveries.endpointId);
  const by = new Map(stats.map((s) => [s.endpointId, s]));
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    description: r.description,
    events: normalizeEvents(r.events),
    active: r.active,
    consecutiveFailures: r.consecutiveFailures,
    disabledReason: r.disabledReason,
    lastSuccessAt: r.lastSuccessAt,
    lastFailureAt: r.lastFailureAt,
    createdAt: r.createdAt,
    stats: { succeeded24h: by.get(r.id)?.ok ?? 0, failed24h: by.get(r.id)?.bad ?? 0, pending: by.get(r.id)?.pending ?? 0 },
  }));
}

/** `url` must already be validated (types/developer validateWebhookUrl); the secret already sealed. */
export async function createWebhookEndpoint(input: {
  tenantId: string;
  url: string;
  description?: string | null;
  events: string[];
  secretSealed: string;
  createdByName: string;
}): Promise<string> {
  const events = normalizeEvents(input.events);
  if (events.length === 0) throw new PlatformError("INVALID", "Pick at least one event.");
  const db = getDb();
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.tenantId, input.tenantId));
  if (count >= MAX_WEBHOOK_ENDPOINTS) throw new PlatformError("LIMIT", `Up to ${MAX_WEBHOOK_ENDPOINTS} webhook URLs per shop.`);
  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      tenantId: input.tenantId,
      url: input.url,
      description: input.description?.trim().slice(0, 120) || null,
      events,
      secretSealed: input.secretSealed,
      createdByName: input.createdByName.slice(0, 80),
    })
    .returning({ id: webhookEndpoints.id });
  return row!.id;
}

async function failPending(endpointId: string, reason: string): Promise<void> {
  await getDb()
    .update(webhookDeliveries)
    .set({ status: "failed", lastError: reason.slice(0, 300), nextAttemptAt: null })
    .where(and(eq(webhookDeliveries.endpointId, endpointId), eq(webhookDeliveries.status, "pending")));
}

export async function updateWebhookEndpoint(
  tenantId: string,
  id: string,
  patch: { url?: string; description?: string | null; events?: string[]; active?: boolean }
): Promise<void> {
  const set: Partial<typeof webhookEndpoints.$inferInsert> = { updatedAt: new Date() };
  if (patch.url !== undefined) set.url = patch.url;
  if (patch.description !== undefined) set.description = patch.description?.trim().slice(0, 120) || null;
  if (patch.events !== undefined) {
    const events = normalizeEvents(patch.events);
    if (events.length === 0) throw new PlatformError("INVALID", "Pick at least one event.");
    set.events = events;
  }
  if (patch.active !== undefined) {
    set.active = patch.active;
    if (patch.active) Object.assign(set, { consecutiveFailures: 0, disabledReason: null });
    else set.disabledReason = "Turned off by the shop.";
  }
  const [row] = await getDb()
    .update(webhookEndpoints)
    .set(set)
    .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, id)))
    .returning({ id: webhookEndpoints.id });
  if (!row) throw new PlatformError("NOT_FOUND", "That webhook doesn't exist.");
  if (patch.active === false) await failPending(id, "Webhook turned off.");
}

export async function setWebhookSecret(tenantId: string, id: string, secretSealed: string): Promise<void> {
  const [row] = await getDb()
    .update(webhookEndpoints)
    .set({ secretSealed, updatedAt: new Date() })
    .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, id)))
    .returning({ id: webhookEndpoints.id });
  if (!row) throw new PlatformError("NOT_FOUND", "That webhook doesn't exist.");
}

export async function getWebhookSecretSealed(tenantId: string, id: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ s: webhookEndpoints.secretSealed })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, id)))
    .limit(1);
  return row?.s ?? null;
}

export async function deleteWebhookEndpoint(tenantId: string, id: string): Promise<void> {
  const rows = await getDb()
    .delete(webhookEndpoints)
    .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, id)))
    .returning({ id: webhookEndpoints.id });
  if (rows.length === 0) throw new PlatformError("NOT_FOUND", "That webhook doesn't exist.");
}

export interface WebhookDeliveryRow {
  id: string;
  event: string;
  eventId: string;
  entityId: string;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  responseMs: number | null;
  createdAt: Date;
  deliveredAt: Date | null;
  nextAttemptAt: Date | null;
}

export async function listWebhookDeliveries(tenantId: string, endpointId: string, limit = 30): Promise<WebhookDeliveryRow[]> {
  const rows = await getDb()
    .select({ d: webhookDeliveries, event: webhookEvents.event, entityId: webhookEvents.entityId })
    .from(webhookDeliveries)
    .innerJoin(webhookEvents, eq(webhookEvents.id, webhookDeliveries.eventId))
    .where(and(eq(webhookDeliveries.tenantId, tenantId), eq(webhookDeliveries.endpointId, endpointId)))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => ({
    id: r.d.id,
    event: r.event,
    eventId: r.d.eventId,
    entityId: r.entityId,
    status: r.d.status,
    attempts: r.d.attempts,
    lastStatusCode: r.d.lastStatusCode,
    lastError: r.d.lastError,
    responseMs: r.d.responseMs,
    createdAt: r.d.createdAt,
    deliveredAt: r.d.deliveredAt,
    nextAttemptAt: r.d.status === "pending" ? r.d.nextAttemptAt : null,
  }));
}

/** Queue a delivery again now (a fresh round of retries). */
export async function redeliverWebhook(tenantId: string, deliveryId: string): Promise<void> {
  const [row] = await getDb()
    .update(webhookDeliveries)
    .set({ status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null })
    .where(and(eq(webhookDeliveries.tenantId, tenantId), eq(webhookDeliveries.id, deliveryId)))
    .returning({ id: webhookDeliveries.id });
  if (!row) throw new PlatformError("NOT_FOUND", "That delivery doesn't exist.");
}

// ─── Fan-out and delivery ────────────────────────────────────────────────────

export interface WebhookEnvelope {
  id: string;
  type: string;
  created_at: string;
  shop: { id: string; slug: string };
  data: { object: unknown };
}

/** A test event for one endpoint; returns the delivery id to send right away. */
export async function createTestDelivery(tenantId: string, endpointId: string): Promise<string> {
  const db = getDb();
  const [ep] = await db
    .select({ id: webhookEndpoints.id, slug: tenants.slug })
    .from(webhookEndpoints)
    .innerJoin(tenants, eq(tenants.id, webhookEndpoints.tenantId))
    .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, endpointId)))
    .limit(1);
  if (!ep) throw new PlatformError("NOT_FOUND", "That webhook doesn't exist.");
  return db.transaction(async (tx) => {
    const [ev] = await tx
      .insert(webhookEvents)
      .values({ tenantId, event: "webhook.test", entityType: "shop", entityId: tenantId, fannedOutAt: new Date() })
      .returning();
    const envelope: WebhookEnvelope = {
      id: ev!.id,
      type: "webhook.test",
      created_at: ev!.createdAt.toISOString(),
      shop: { id: tenantId, slug: ep.slug },
      data: { object: { message: "Test event from Guma Kart. If you can read this, your endpoint works." } },
    };
    await tx.update(webhookEvents).set({ payloadJson: envelope as unknown as Record<string, unknown> }).where(eq(webhookEvents.id, ev!.id));
    const [d] = await tx
      .insert(webhookDeliveries)
      .values({ tenantId, endpointId, eventId: ev!.id, nextAttemptAt: new Date(Date.now() + 5 * 60_000) })
      .returning({ id: webhookDeliveries.id });
    return d!.id;
  });
}

/**
 * Turns new events into deliveries: freezes one payload per event (the current state of the
 * order / variant / customer) and queues it for every active endpoint subscribed right now.
 */
export async function fanOutWebhookEvents(options: { limit?: number } = {}): Promise<{ events: number; deliveries: number }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(webhookEvents)
      .where(isNull(webhookEvents.fannedOutAt))
      .orderBy(asc(webhookEvents.createdAt))
      .limit(options.limit ?? 200)
      .for("update", { skipLocked: true });
    if (due.length === 0) return { events: 0, deliveries: 0 };

    const byTenant = new Map<string, typeof due>();
    for (const e of due) byTenant.set(e.tenantId, [...(byTenant.get(e.tenantId) ?? []), e]);
    let deliveries = 0;

    for (const [tenantId, events] of byTenant) {
      const [shop] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      const endpoints = await tx
        .select({ id: webhookEndpoints.id, events: webhookEndpoints.events })
        .from(webhookEndpoints)
        .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.active, true)));
      const ids = (type: string) => events.filter((e) => e.entityType === type).map((e) => e.entityId);
      const [ordersById, variantsById, customersById, productsById] = await Promise.all([
        apiOrdersByIds(tenantId, ids("order")),
        apiVariantsByIds(tenantId, ids("variant")),
        apiCustomersByIds(tenantId, ids("customer")),
        apiProductsByIds(tenantId, ids("product")),
      ]);
      for (const e of events) {
        const object =
          e.entityType === "order"
            ? ordersById.get(e.entityId)
            : e.entityType === "variant"
              ? variantsById.get(e.entityId)
              : e.entityType === "customer"
                ? customersById.get(e.entityId)
                : e.entityType === "product"
                  ? productsById.get(e.entityId)
                  : undefined;
        const envelope: WebhookEnvelope = {
          id: e.id,
          type: e.event,
          created_at: e.createdAt.toISOString(),
          shop: { id: tenantId, slug: shop?.slug ?? "" },
          data: { object: object ?? { id: e.entityId, deleted: true } },
        };
        await tx
          .update(webhookEvents)
          .set({ payloadJson: envelope as unknown as Record<string, unknown>, fannedOutAt: new Date() })
          .where(eq(webhookEvents.id, e.id));
        const targets = endpoints.filter((ep) => ep.events.includes(e.event) || ep.events.includes("*"));
        if (targets.length) {
          await tx
            .insert(webhookDeliveries)
            .values(targets.map((ep) => ({ tenantId, endpointId: ep.id, eventId: e.id })))
            .onConflictDoNothing();
          deliveries += targets.length;
        }
      }
    }
    return { events: due.length, deliveries };
  });
}

export interface DueDelivery {
  id: string;
  tenantId: string;
  endpointId: string;
  url: string;
  secretSealed: string;
  eventId: string;
  event: string;
  attempts: number;
  body: string;
}

/**
 * Claims due deliveries for sending. Each claimed row is leased for 5 minutes (next_attempt_at
 * moves forward), so overlapping runs never send the same delivery twice at once and a
 * crashed run's rows come back by themselves.
 */
export async function claimDueDeliveries(options: { limit?: number; deliveryId?: string; now?: Date } = {}): Promise<DueDelivery[]> {
  const db = getDb();
  const now = options.now ?? new Date();
  const lease = new Date(now.getTime() + 5 * 60_000);
  const picked = options.deliveryId
    ? sql`select ${webhookDeliveries.id} from ${webhookDeliveries} where ${webhookDeliveries.id} = ${options.deliveryId} and ${webhookDeliveries.status} = 'pending' for update skip locked`
    : sql`select d."id" from "webhook_deliveries" d join "webhook_endpoints" e on e."id" = d."endpoint_id" and e."active"
          where d."status" = 'pending' and d."next_attempt_at" <= ${now.toISOString()}::timestamptz
          order by d."next_attempt_at" limit ${options.limit ?? 50} for update of d skip locked`;
  const claimed = await db.execute(
    sql`update "webhook_deliveries" set "next_attempt_at" = ${lease.toISOString()}::timestamptz where "id" in (${picked}) returning "id"`
  );
  const ids = (claimed as unknown as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ d: webhookDeliveries, url: webhookEndpoints.url, secret: webhookEndpoints.secretSealed, event: webhookEvents.event, payload: webhookEvents.payloadJson })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .innerJoin(webhookEvents, eq(webhookEvents.id, webhookDeliveries.eventId))
    .where(inArray(webhookDeliveries.id, ids));
  return rows.map((r) => ({
    id: r.d.id,
    tenantId: r.d.tenantId,
    endpointId: r.d.endpointId,
    url: r.url,
    secretSealed: r.secret,
    eventId: r.d.eventId,
    event: r.event,
    attempts: r.d.attempts,
    body: JSON.stringify(r.payload ?? {}),
  }));
}

export interface DeliveryOutcome {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  ms: number;
}

/** Saves one attempt. Failures schedule the next try; a long losing streak turns the endpoint off. */
export async function recordDeliveryResult(delivery: DueDelivery, outcome: DeliveryOutcome, now = new Date()): Promise<"succeeded" | "retry" | "failed"> {
  const db = getDb();
  const attempts = delivery.attempts + 1;
  const isTest = delivery.event === "webhook.test";
  if (outcome.ok) {
    await db
      .update(webhookDeliveries)
      .set({ status: "succeeded", attempts, deliveredAt: now, lastStatusCode: outcome.statusCode, lastError: null, responseMs: outcome.ms, nextAttemptAt: null })
      .where(eq(webhookDeliveries.id, delivery.id));
    await db
      .update(webhookEndpoints)
      .set({ consecutiveFailures: 0, lastSuccessAt: now })
      .where(eq(webhookEndpoints.id, delivery.endpointId));
    return "succeeded";
  }
  const next = isTest ? null : nextWebhookAttempt(attempts, now);
  await db
    .update(webhookDeliveries)
    .set({
      status: next ? "pending" : "failed",
      attempts,
      nextAttemptAt: next,
      lastStatusCode: outcome.statusCode,
      lastError: (outcome.error ?? `HTTP ${outcome.statusCode}`).slice(0, 300),
      responseMs: outcome.ms,
    })
    .where(eq(webhookDeliveries.id, delivery.id));
  if (!isTest) {
    const [ep] = await db
      .update(webhookEndpoints)
      .set({ consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1`, lastFailureAt: now })
      .where(eq(webhookEndpoints.id, delivery.endpointId))
      .returning({ failures: webhookEndpoints.consecutiveFailures, active: webhookEndpoints.active });
    if (ep && ep.active && ep.failures >= WEBHOOK_DISABLE_AFTER) {
      await db
        .update(webhookEndpoints)
        .set({ active: false, disabledReason: `Turned off after ${WEBHOOK_DISABLE_AFTER} failed attempts in a row. Fix the URL, then turn it back on.`, updatedAt: now })
        .where(eq(webhookEndpoints.id, delivery.endpointId));
      await failPending(delivery.endpointId, "Webhook turned off after repeated failures.");
    }
  }
  return next ? "retry" : "failed";
}

/** Events (and their deliveries) are kept 30 days. */
export async function pruneWebhookEvents(now = new Date(), batch = 2000): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const res = await getDb().execute(
    sql`delete from "webhook_events" where "id" in (select "id" from "webhook_events" where "created_at" < ${cutoff.toISOString()}::timestamptz limit ${batch})`
  );
  return (res as unknown as { count?: number }).count ?? 0;
}

/** For the ops console / health: how far behind webhooks are. */
export async function webhookBacklog(): Promise<{ unfanned: number; pending: number; oldestPendingMinutes: number }> {
  const db = getDb();
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(webhookEvents).where(isNull(webhookEvents.fannedOutAt));
  const [b] = await db
    .select({ n: sql<number>`count(*)::int`, oldest: sql<number>`coalesce(extract(epoch from now() - min(${webhookDeliveries.createdAt})) / 60, 0)::int` })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, "pending"), lt(webhookDeliveries.createdAt, sql`now()`)));
  return { unfanned: a?.n ?? 0, pending: b?.n ?? 0, oldestPendingMinutes: b?.oldest ?? 0 };
}
