/**
 * Phase 24: parcel courier waybills (J&T Express, LBC, Flash Express, Ninja Van…) — READY TO HOOK UP.
 *
 * Today the seller books the parcel in the courier's own app or counter and types the waybill number
 * into Orders → Assign rider or courier; the buyer gets it by SMS and on their order page.
 *
 * When an aggregator account exists (one API for several couriers, with label PDFs), implement this
 * interface in an adapter, register it in `createWaybillProvider()`, and the orders page can offer
 * "Book & print waybill". Keys go in WAYBILL_PROVIDER / WAYBILL_API_KEY (never in code).
 */

export interface WaybillParcel {
  orderNumber: string;
  sender: { name: string; phone: string; address: string };
  recipient: { name: string; phone: string; address: string; province?: string; city?: string; barangay?: string };
  weightKg: number;
  codAmount?: number;
  declaredValue?: number;
  itemsSummary: string;
}

export interface WaybillBooking {
  courier: string;
  trackingNumber: string;
  /** Printable label (PDF/PNG URL from the provider). */
  labelUrl?: string;
  fee?: number;
}

export interface WaybillProvider {
  id: string;
  label: string;
  /** Couriers this provider can book. */
  couriers(): Promise<string[]>;
  quote(parcel: WaybillParcel): Promise<Array<{ courier: string; fee: number; etaDays?: number }>>;
  book(parcel: WaybillParcel, courier: string): Promise<WaybillBooking>;
}

/** No aggregator is wired yet — returns null until an adapter is added for WAYBILL_PROVIDER. */
export function createWaybillProvider(): WaybillProvider | null {
  const id = process.env.WAYBILL_PROVIDER?.trim();
  if (!id || !process.env.WAYBILL_API_KEY?.trim()) return null;
  // Register adapters here, e.g. `if (id === "<aggregator>") return new <Aggregator>Adapter(key)`.
  return null;
}
