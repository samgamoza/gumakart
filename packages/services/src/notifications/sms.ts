import {
  assertIntegrationReady,
  allowIntegrationMocks,
} from "../config/integrations";
import { createLogger } from "../logging";

const SEMAPHORE_API = "https://api.semaphore.co/api/v4/messages";
const log = createLogger("sms");

export interface SendSmsInput {
  to: string;
  message: string;
  priority?: boolean;
}

export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  /** True when this was a labeled local/test mock — never set when claiming a real send. */
  mock?: boolean;
  error?: string;
}

export class SemaphoreClient {
  constructor(private apiKey: string) {}

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    if (!this.apiKey.trim()) {
      if (allowIntegrationMocks()) {
        assertIntegrationReady("semaphore", { operation: "send" });
        log.warn("SMS mock — credentials missing; labeled mock success only", {
          to: input.to,
        });
        console.info("[SMS Mock]", input.to, input.message);
        return { success: true, messageId: `sms_mock_${Date.now()}`, mock: true };
      }

      log.warn("Semaphore not configured — SMS not sent", { to: input.to });
      return {
        success: false,
        error: "SEMAPHORE_API_KEY is not configured. SMS was not sent.",
      };
    }

    const body = new URLSearchParams({
      apikey: this.apiKey,
      number: input.to.replace(/^\+63/, "0").replace(/\D/g, ""),
      message: input.message,
      // Registered sender name (e.g. GUMAKART). Without one Semaphore uses its default.
      ...(process.env.SEMAPHORE_SENDER_NAME?.trim() ? { sendername: process.env.SEMAPHORE_SENDER_NAME.trim() } : {}),
      ...(input.priority ? { priority: "true" } : {}),
    });

    const res = await fetch(SEMAPHORE_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Semaphore SMS failed: ${detail}`);
    }

    const json = (await res.json()) as Array<{ message_id: string }>;
    return { success: true, messageId: json[0]?.message_id };
  }

  orderConfirmation(params: {
    to: string;
    orderNumber: string;
    total: string;
    trackingUrl?: string;
  }): Promise<SendSmsResult> {
    return this.send({ to: params.to, message: orderConfirmationMessage(params), priority: true });
  }
}

export function orderConfirmationMessage(params: {
  orderNumber: string;
  total: string;
  trackingUrl?: string;
}): string {
  return params.trackingUrl
    ? `Guma One: Order ${params.orderNumber} confirmed! Total ${params.total}. Track: ${params.trackingUrl}`
    : `Guma One: Order ${params.orderNumber} confirmed! Total ${params.total}. Salamat po!`;
}

export function createSemaphoreClient(): SemaphoreClient {
  return new SemaphoreClient(process.env.SEMAPHORE_API_KEY ?? "");
}

export function formatPhp(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 0 })}`;
}

export function generateOrderNumber(prefix: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix.toUpperCase()}-${date}-${rand}`;
}
