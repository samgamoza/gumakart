/**
 * Phase 17b: "Tandaan ako sa device na ito" — the buyer's own details kept in this browser only
 * (localStorage, never sent anywhere). Opt-in at checkout, one tap to erase. Works without Guma ID,
 * so returning buyers on their own phone don't retype everything. Guma ID, when signed in, wins.
 */
import type { KartAddress } from "@/lib/kart/ph-address";
import type { PhAddressValue } from "@/components/ph-address-fields";

const KEY = "guma-buyer:v1";
const MAX_AGE_MS = 365 * 86_400_000;

export interface RememberedBuyer {
  name: string;
  phone: string;
  email: string;
  /** Canonical address (the checkout-link shape); street2 is kept as the landmark line. */
  address: KartAddress | null;
  savedAt: number;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function cleanAddress(a: unknown): KartAddress | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  const out: KartAddress = {
    line1: str(o.line1, 300),
    regionCode: str(o.regionCode, 20),
    region: str(o.region, 120),
    provinceCode: str(o.provinceCode, 20),
    province: str(o.province, 120),
    cityCode: str(o.cityCode, 20),
    city: str(o.city, 120),
    barangay: str(o.barangay, 120),
    landmark: str(o.landmark, 300),
  };
  return out.line1 || out.city ? out : null;
}

export function readRememberedBuyer(): RememberedBuyer | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const savedAt = typeof o.savedAt === "number" ? o.savedAt : 0;
    if (Date.now() - savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    const b: RememberedBuyer = { name: str(o.name, 120), phone: str(o.phone, 20), email: str(o.email, 200), address: cleanAddress(o.address), savedAt };
    return b.name || b.phone ? b : null;
  } catch {
    return null;
  }
}

export function saveRememberedBuyer(b: Omit<RememberedBuyer, "savedAt">): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...b, address: b.address ? cleanAddress(b.address) : null, savedAt: Date.now() }));
  } catch {
    /* private mode / storage full — remembering is a convenience only */
  }
}

export function forgetRememberedBuyer(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Storefront checkout uses the PH address fields shape. */
export function phToKart(a: PhAddressValue): KartAddress {
  return {
    line1: a.street1.slice(0, 200),
    regionCode: "",
    region: "",
    provinceCode: a.provinceCode,
    province: a.province,
    cityCode: a.cityCode,
    city: a.city,
    barangay: a.barangay,
    landmark: a.street2.slice(0, 120),
  };
}

export function kartToPh(a: KartAddress): PhAddressValue {
  return {
    street1: a.line1,
    street2: a.landmark,
    barangay: a.barangay,
    city: a.city,
    province: a.province,
    provinceCode: a.provinceCode,
    cityCode: a.cityCode,
  };
}
