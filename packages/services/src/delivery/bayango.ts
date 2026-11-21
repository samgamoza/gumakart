import type { CourierFulfillment } from "./courier-status";
import { createLogger } from "../logging";
import { allowIntegrationMocks } from "../config/integrations";
import { verifyTimestampedHmacSignature } from "./webhook-signature";

/**
 * BayanGo Partner API client — implements docs/BAYANGO-PARTNER-API-CONTRACT.md.
 *
 * Money crosses the wire as integer centavos; this client converts to pesos at
 * the edge so the rest of Guma keeps working in pesos. Change this file and the
 * contract doc together.
 */

const log = createLogger("bayango");
const REQUEST_TIMEOUT_MS = 10_000;
export const BAYANGO_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type BayanGoStatus =
  | "pending"
  | "assigned"
  | "pickup_scheduled"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "failed_delivery"
  | "returned"
  | "cancelled";

export const BAYANGO_STATUSES: readonly BayanGoStatus[] = [
  "pending",
  "assigned",
  "pickup_scheduled",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "failed_delivery",
  "returned",
  "cancelled",
];

/** Partner statuses that move a Guma order forward (contract §3.3). */
/** BayanGo partner statuses map 1:1 onto Guma Kart fulfillment (Phase 2). */
export const BAYANGO_STATUS_TO_FULFILLMENT: Partial<Record<BayanGoStatus, CourierFulfillment>> = {
  pending: "booked",
  assigned: "booked",
  pickup_scheduled: "booked",
  picked_up: "picked_up",
  in_transit: "out_for_delivery",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  failed_delivery: "failed_delivery",
  returned: "returned",
  cancelled: "booking_cancelled",
};

/** Partner statuses that need the merchant to act (rebook / contact buyer). */
export const BAYANGO_ATTENTION_STATUSES: readonly BayanGoStatus[] = [
  "failed_delivery",
  "returned",
  "cancelled",
];

export interface BayanGoPoint {
  lat: number;
  lng: number;
}

export interface BayanGoStop extends BayanGoPoint {
  address: string;
}

export interface BayanGoQuote {
  quoteId: string;
  /** Pesos (converted from feeCents). */
  fee: number;
  currency: string;
  etaMinutes?: number;
  distanceKm?: number;
  expiresAt?: string;
  mock?: boolean;
}

export interface BayanGoBookInput {
  quoteId: string;
  externalRef: string;
  merchant: { externalId: string; name: string; phone?: string };
  pickup: BayanGoStop & { contactName?: string; contactPhone?: string; notes?: string };
  dropoff: BayanGoStop & { recipientName: string; recipientPhone: string; notes?: string };
  /** Pesos; omit or 0 for prepaid. */
  codAmount?: number;
  scheduledPickupAt?: string | null;
  remarks?: string;
}

export interface BayanGoBooking {
  deliveryId: string;
  status: BayanGoStatus;
  fee?: number;
  trackingUrl?: string;
  mock?: boolean;
}

export interface BayanGoWebhookRider {
  name?: string;
  phone?: string;
  plateNumber?: string;
  vehicleType?: string;
}

export interface BayanGoWebhookEvent {
  eventId: string;
  /** "delivery.completed" (AI suite Phase 4 review loop) is a status change to "delivered". */
  type: "delivery.status_changed" | "delivery.location" | "delivery.completed";
  occurredAt?: string;
  delivery: {
    deliveryId: string;
    externalRef?: string;
    status: BayanGoStatus;
    trackingUrl?: string;
    rider?: BayanGoWebhookRider;
    location?: { lat: number; lng: number; at?: string };
    failureReason?: string | null;
  };
}

export class BayanGoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "BayanGoApiError";
  }
}

export const pesosToCents = (pesos: number): number => Math.round(pesos * 100);
export const centsToPesos = (cents: number): number => Math.round(cents) / 100;

type FetchLike = typeof fetch;

export interface BayanGoClientOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
}

export class BayanGoClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: BayanGoClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.BAYANGO_API_BASE_URL ?? "")
      .trim()
      .replace(/\/+$/, "");
    this.apiKey = (options.apiKey ?? process.env.BAYANGO_API_KEY ?? "").trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  configured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  /** Mocks only outside production, and only when credentials are absent. */
  private mode(operation: string): "live" | "mock" {
    if (this.configured()) return "live";
    if (allowIntegrationMocks()) {
      log.warn(`Using BayanGo mock for ${operation} (BAYANGO_API_BASE_URL/KEY missing)`);
      return "mock";
    }
    throw new BayanGoApiError(
      "BayanGo is not configured (BAYANGO_API_BASE_URL / BAYANGO_API_KEY).",
      503,
      "not_configured"
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    idempotencyKey?: string
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let json: unknown = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      if (!res.ok) {
        const err = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
        throw new BayanGoApiError(
          `BayanGo ${method} ${path} failed (${res.status}): ${err?.message ?? text.slice(0, 200)}`,
          res.status,
          err?.code
        );
      }
      return json as T;
    } catch (error) {
      if (error instanceof BayanGoApiError) throw error;
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new BayanGoApiError(
        aborted
          ? `BayanGo ${method} ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `BayanGo ${method} ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
        aborted ? 504 : 502
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async serviceability(pickup: BayanGoPoint, dropoff: BayanGoPoint): Promise<boolean> {
    if (this.mode("serviceability") === "mock") return true;
    const res = await this.request<{ serviceable?: boolean }>("POST", "/serviceability", {
      pickup,
      dropoff,
    });
    return res?.serviceable === true;
  }

  async quote(input: {
    pickup: BayanGoStop;
    dropoff: BayanGoStop;
    vehicleType?: string;
    codAmount?: number;
  }): Promise<BayanGoQuote> {
    if (this.mode("quote") === "mock") {
      return {
        quoteId: `qt_mock_${Date.now()}`,
        fee: 79,
        currency: "PHP",
        etaMinutes: 40,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        mock: true,
      };
    }
    const res = await this.request<{
      quoteId: string;
      feeCents: number;
      currency?: string;
      etaMinutes?: number;
      distanceKm?: number;
      expiresAt?: string;
    }>("POST", "/quotes", {
      pickup: input.pickup,
      dropoff: input.dropoff,
      vehicleType: input.vehicleType ?? "motorcycle",
      ...(input.codAmount ? { codAmountCents: pesosToCents(input.codAmount) } : {}),
    });
    if (!res?.quoteId || typeof res.feeCents !== "number") {
      throw new BayanGoApiError("BayanGo quote response is missing quoteId/feeCents.", 502);
    }
    return {
      quoteId: res.quoteId,
      fee: centsToPesos(res.feeCents),
      currency: res.currency ?? "PHP",
      etaMinutes: res.etaMinutes,
      distanceKm: res.distanceKm,
      expiresAt: res.expiresAt,
    };
  }

  async book(input: BayanGoBookInput): Promise<BayanGoBooking> {
    if (this.mode("book") === "mock") {
      return {
        deliveryId: `dlv_mock_${Date.now()}`,
        status: "pending",
        trackingUrl: undefined,
        mock: true,
      };
    }
    const res = await this.request<{
      deliveryId: string;
      status: string;
      feeCents?: number;
      trackingUrl?: string;
    }>(
      "POST",
      "/deliveries",
      {
        quoteId: input.quoteId,
        externalRef: input.externalRef,
        merchant: input.merchant,
        pickup: input.pickup,
        dropoff: input.dropoff,
        payment:
          input.codAmount && input.codAmount > 0
            ? { type: "cod", codAmountCents: pesosToCents(input.codAmount) }
            : { type: "prepaid" },
        scheduledPickupAt: input.scheduledPickupAt ?? null,
        remarks: input.remarks,
      },
      input.externalRef
    );
    if (!res?.deliveryId) {
      throw new BayanGoApiError("BayanGo booking response is missing deliveryId.", 502);
    }
    return {
      deliveryId: res.deliveryId,
      status: normalizeBayanGoStatus(res.status) ?? "pending",
      fee: typeof res.feeCents === "number" ? centsToPesos(res.feeCents) : undefined,
      trackingUrl: res.trackingUrl,
    };
  }

  async cancel(deliveryId: string, reason = "merchant_cancelled"): Promise<void> {
    if (this.mode("cancel") === "mock") return;
    await this.request(
      "POST",
      `/deliveries/${encodeURIComponent(deliveryId)}/cancel`,
      { reason },
      `cancel:${deliveryId}`
    );
  }
}

export function createBayanGoClient(options?: BayanGoClientOptions): BayanGoClient {
  return new BayanGoClient(options);
}

export function normalizeBayanGoStatus(raw: unknown): BayanGoStatus | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return (BAYANGO_STATUSES as readonly string[]).includes(s) ? (s as BayanGoStatus) : null;
}

/** Parses a webhook body; returns null when it doesn't match the contract. */
export function parseBayanGoWebhook(payload: unknown): BayanGoWebhookEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const delivery = p.delivery as Record<string, unknown> | undefined;
  if (typeof p.eventId !== "string" || !delivery) return null;
  if (p.type !== "delivery.status_changed" && p.type !== "delivery.location" && p.type !== "delivery.completed") return null;
  if (typeof delivery.deliveryId !== "string" || !delivery.deliveryId) return null;
  const status = p.type === "delivery.completed" ? normalizeBayanGoStatus(delivery.status ?? "delivered") : normalizeBayanGoStatus(delivery.status);
  if (p.type === "delivery.completed" && status !== "delivered") return null;
  if (!status) return null;

  const loc = delivery.location as Record<string, unknown> | undefined;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  const rider = delivery.rider as Record<string, unknown> | undefined;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

  return {
    eventId: p.eventId,
    type: p.type,
    occurredAt: str(p.occurredAt),
    delivery: {
      deliveryId: delivery.deliveryId,
      externalRef: str(delivery.externalRef),
      status,
      trackingUrl: str(delivery.trackingUrl),
      rider: rider
        ? {
            name: str(rider.name),
            phone: str(rider.phone),
            plateNumber: str(rider.plateNumber),
            vehicleType: str(rider.vehicleType),
          }
        : undefined,
      location:
        loc && Number.isFinite(lat) && Number.isFinite(lng)
          ? { lat, lng, at: str(loc.at) }
          : undefined,
      failureReason: str(delivery.failureReason) ?? null,
    },
  };
}

/** Contract §3.1: HMAC over `${timestamp}.${rawBody}`, ±5 minutes. */
export function verifyBayanGoWebhook(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  nowSeconds?: number;
}): boolean {
  const { rawBody, signature, timestamp, secret } = input;
  if (!signature || !timestamp || !secret.trim()) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > BAYANGO_WEBHOOK_TOLERANCE_SECONDS) return false;
  return verifyTimestampedHmacSignature({ rawBody, signature, timestamp, secret });
}
