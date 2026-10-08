import { createHmac, timingSafeEqual } from "crypto";
import {
  assertIntegrationReady,
  allowIntegrationMocks,
} from "../config/integrations";
import { createLogger } from "../logging";

const PAYMONGO_API = "https://api.paymongo.com/v1";
const log = createLogger("paymongo");

export type PayMongoMethod = "gcash" | "paymaya" | "qrph" | "card";

export interface CreatePaymentIntentInput {
  amountCentavos: number;
  description: string;
  methods?: PayMongoMethod[];
  metadata?: Record<string, string>;
}

export interface PaymentIntentResult {
  id: string;
  clientKey: string;
  status: string;
  amount: number;
  /** True when this response is a labeled local/test mock — never set in production. */
  mock?: boolean;
}

export interface CreateCheckoutSessionInput {
  amountCentavos: number;
  lineItemName: string;
  description: string;
  methods: PayMongoMethod[];
  /** Our reference shown to the buyer on PayMongo and echoed in webhooks. */
  referenceNumber: string;
  successUrl: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  id: string;
  checkoutUrl: string;
  /** Key we store on the payment row (payment intent id, else the session id). */
  paymentIntentId: string;
  mock?: boolean;
}

/**
 * Pulls the ids we need out of a PayMongo webhook event, for both the hosted
 * checkout event and the plain payment events.
 */
export function parsePayMongoPaymentEvent(event: unknown): {
  type: string;
  intentId?: string;
  sessionId?: string;
  paymentId?: string;
  /** What PayMongo says was paid (security G2, GK-16): checked against our charge row. */
  amountCentavos?: number;
  currency?: string;
} | null {
  const attrs = (event as { data?: { attributes?: { type?: unknown; data?: unknown } } })?.data
    ?.attributes;
  if (!attrs || typeof attrs.type !== "string") return null;
  const resource = attrs.data as
    | { id?: string; attributes?: Record<string, unknown> }
    | undefined;
  const r = resource?.attributes ?? {};
  if (attrs.type.startsWith("checkout_session.")) {
    const intent = r.payment_intent as { id?: string } | null | undefined;
    const payments = Array.isArray(r.payments) ? (r.payments as Array<{ id?: string; attributes?: { amount?: unknown; currency?: unknown } }>) : [];
    const paid = payments[0]?.attributes;
    return {
      type: attrs.type,
      sessionId: resource?.id,
      intentId: intent?.id,
      paymentId: payments[0]?.id,
      amountCentavos: Number.isInteger(paid?.amount) ? Number(paid!.amount) : undefined,
      currency: typeof paid?.currency === "string" ? paid.currency : undefined,
    };
  }
  return {
    type: attrs.type,
    intentId: typeof r.payment_intent_id === "string" ? r.payment_intent_id : undefined,
    paymentId: resource?.id,
    amountCentavos: Number.isInteger(r.amount) ? Number(r.amount) : undefined,
    currency: typeof r.currency === "string" ? r.currency : undefined,
  };
}

function isUsableSecret(secretKey: string): boolean {
  if (!secretKey.trim()) return false;
  if (secretKey.startsWith("sk_test_xxx")) return false;
  if (secretKey === "sk_test_placeholder") return false;
  return true;
}

export class PayMongoClient {
  constructor(private secretKey: string) {}

  private authHeader(): string {
    const encoded = Buffer.from(`${this.secretKey}:`).toString("base64");
    return `Basic ${encoded}`;
  }

  private ensureLiveOrMock(operation: string): "live" | "mock" {
    if (isUsableSecret(this.secretKey)) return "live";
    assertIntegrationReady("paymongo", { operation });
    if (!allowIntegrationMocks()) {
      // assert should have thrown; belt-and-suspenders
      assertIntegrationReady("paymongo", { operation });
    }
    log.warn(`Using explicit PayMongo mock for ${operation} (credentials missing)`);
    return "mock";
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
    if (this.ensureLiveOrMock("createPaymentIntent") === "mock") {
      return {
        id: `pi_mock_${Date.now()}`,
        clientKey: `pi_mock_${Date.now()}_client`,
        status: "awaiting_payment_method",
        amount: input.amountCentavos,
        mock: true,
      };
    }

    const res = await fetch(`${PAYMONGO_API}/payment_intents`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount: input.amountCentavos,
            currency: "PHP",
            payment_method_allowed: input.methods ?? ["gcash", "paymaya", "qrph", "card"],
            description: input.description,
            metadata: input.metadata,
          },
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`PayMongo create intent failed: ${err}`);
    }

    const json = (await res.json()) as {
      data: { id: string; attributes: { client_key: string; status: string; amount: number } };
    };

    return {
      id: json.data.id,
      clientKey: json.data.attributes.client_key,
      status: json.data.attributes.status,
      amount: json.data.attributes.amount,
    };
  }

  /**
   * PayMongo hosted checkout (POST /v1/checkout_sessions). One integration for
   * GCash, Maya, QR Ph and cards — the buyer pays on PayMongo's page and comes
   * back to `successUrl`. Card details never touch our servers.
   *
   * We key the payment on the session's payment intent id, so both
   * `checkout_session.payment.paid` and `payment.paid` webhooks land on the same
   * payment row (and the second one is a no-op).
   */
  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult> {
    if (this.ensureLiveOrMock("createCheckoutSession") === "mock") {
      const id = `cs_mock_${Date.now()}`;
      return {
        id,
        checkoutUrl: `${input.successUrl}${input.successUrl.includes("?") ? "&" : "?"}mock_checkout=${id}`,
        paymentIntentId: `pi_mock_${Date.now()}`,
        mock: true,
      };
    }

    const res = await fetch(`${PAYMONGO_API}/checkout_sessions`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [
              {
                name: input.lineItemName.slice(0, 255),
                amount: input.amountCentavos,
                currency: "PHP",
                quantity: 1,
              },
            ],
            payment_method_types: input.methods,
            description: input.description,
            reference_number: input.referenceNumber,
            success_url: input.successUrl,
            cancel_url: input.cancelUrl ?? input.successUrl,
            send_email_receipt: false,
            show_line_items: true,
            metadata: input.metadata,
          },
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`PayMongo create checkout session failed: ${await res.text()}`);
    }

    const json = (await res.json()) as {
      data: {
        id: string;
        attributes: { checkout_url?: string; payment_intent?: { id?: string } | null };
      };
    };
    const checkoutUrl = json.data.attributes.checkout_url;
    if (!checkoutUrl) throw new Error("PayMongo checkout session returned no checkout_url");
    return {
      id: json.data.id,
      checkoutUrl,
      // Fall back to the session id; the webhook handler looks up either.
      paymentIntentId: json.data.attributes.payment_intent?.id ?? json.data.id,
    };
  }

  async createRefund(input: {
    paymentId: string;
    amountCentavos: number;
    reason?: "duplicate" | "fraudulent" | "requested_by_customer" | "others";
    notes?: string;
  }): Promise<{ id: string; status: string; mock?: boolean }> {
    if (input.paymentId.startsWith("pay_mock_") || !isUsableSecret(this.secretKey)) {
      if (this.ensureLiveOrMock("createRefund") === "mock") {
        return { id: `ref_mock_${Date.now()}`, status: "succeeded", mock: true };
      }
    }

    const res = await fetch(`${PAYMONGO_API}/refunds`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount: input.amountCentavos,
            payment_id: input.paymentId,
            reason: input.reason ?? "requested_by_customer",
            notes: input.notes,
          },
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`PayMongo refund failed: ${await res.text()}`);
    }

    const json = (await res.json()) as {
      data: { id: string; attributes: { status: string } };
    };
    return { id: json.data.id, status: json.data.attributes.status };
  }

  verifyWebhookSignature(payload: string, signatureHeader: string, webhookSecret: string): boolean {
    // A missing secret must never mean "accept everything". Reject and force
    // the operator to configure PAYMONGO_WEBHOOK_SECRET.
    if (!webhookSecret) return false;

    const parts = signatureHeader.split(",").reduce(
      (acc, part) => {
        const [k, v] = part.split("=");
        if (k && v) acc[k.trim()] = v.trim();
        return acc;
      },
      {} as Record<string, string>
    );

    // PayMongo signs as `t=<timestamp>,te=<test-mode sig>,li=<live-mode sig>`.
    const timestamp = parts["t"];
    const signature = parts["li"] || parts["te"] || parts["v1"];
    if (!timestamp || !signature) return false;

    // Reject events older than 5 minutes to limit replay windows.
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds)) return false;
    const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
    if (ageSeconds > 300) return false;

    const signed = `${timestamp}.${payload}`;
    const expected = createHmac("sha256", webhookSecret).update(signed).digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    let providedBuf: Buffer;
    try {
      providedBuf = Buffer.from(signature, "hex");
    } catch {
      return false;
    }
    if (providedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  }
}

export function createPayMongoClient(): PayMongoClient {
  return new PayMongoClient(process.env.PAYMONGO_SECRET_KEY ?? "");
}
