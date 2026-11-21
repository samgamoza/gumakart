import { geocodeAddress, type GeocodeResult } from "./geocode";
import { quoteAll } from "./orchestrator";
import type { DeliveryQuote, DeliveryQuoteRequest } from "./provider";

/**
 * AI suite Phase 3 — delivery fee for a chat: BayanGo's rate engine first, Lalamove when the
 * address is outside BayanGo's zone (or BayanGo is off), the shop's own flat rate as the last
 * resort. Free delivery is only ever the shop's own rule (D5).
 */
export interface ChatDeliveryQuote {
  provider: "bayango" | "lalamove" | "shop_rate";
  fee: number;
  etaMinutes: number | null;
  /** true = a live courier quote; false = the shop's standard rate. */
  isLive: boolean;
  free: boolean;
  freeDeliveryMin: number | null;
  dropoff: string;
}

export interface ChatQuoteDeps {
  geocode?: (address: string) => Promise<GeocodeResult | null>;
  quote?: typeof quoteAll;
}

export async function quoteChatDelivery(
  input: { pickupAddress: string; dropoff: string; subtotal?: number | null; flatRate: number; freeDeliveryMin: number },
  deps: ChatQuoteDeps = {}
): Promise<ChatDeliveryQuote> {
  const geocode = deps.geocode ?? geocodeAddress;
  const quote = deps.quote ?? quoteAll;
  const dropoff = input.dropoff.trim().replace(/\s+/g, " ");
  const freeMin = input.freeDeliveryMin > 0 ? input.freeDeliveryMin : null;
  const free = freeMin !== null && (input.subtotal ?? 0) >= freeMin;
  const fallback: ChatDeliveryQuote = { provider: "shop_rate", fee: free ? 0 : input.flatRate, etaMinutes: null, isLive: false, free, freeDeliveryMin: freeMin, dropoff };

  if (!input.pickupAddress.trim() || dropoff.length < 4) return fallback;
  const dropoffQuery = /philippines/i.test(dropoff) ? dropoff : `${dropoff}, Philippines`;
  const [from, to] = await Promise.all([geocode(input.pickupAddress), geocode(dropoffQuery)]);
  if (!from || !to) return fallback;

  const request: DeliveryQuoteRequest = {
    pickup: { address: input.pickupAddress, coordinates: { lat: String(from.lat), lng: String(from.lng) } },
    dropoff: { address: dropoffQuery, coordinates: { lat: String(to.lat), lng: String(to.lng) } },
  };
  for (const provider of ["bayango", "lalamove"] as const) {
    const attempts = await quote(request, { allow: [provider] });
    const q: DeliveryQuote | undefined = attempts.find((a) => a.quote)?.quote;
    if (q) {
      return { provider, fee: free ? 0 : Math.round(q.fee), etaMinutes: q.etaMinutes ?? null, isLive: true, free, freeDeliveryMin: freeMin, dropoff };
    }
  }
  return fallback;
}
