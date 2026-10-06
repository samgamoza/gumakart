/**
 * Tenant shipping configuration — draft and published share the same shape.
 * Storefront reads shipping_published_json (with settings_json.delivery fallback).
 */

export type ShippingCourierProvider = "manual" | "lalamove" | "grab";

export interface ShippingZone {
  id: string;
  name: string;
  match?: {
    provinces?: string[];
    cities?: string[];
    barangays?: string[];
    postalPrefixes?: string[];
  };
}

export interface ShippingRate {
  id: string;
  /** Omit = applies to all zones for the method */
  zoneId?: string;
  basis: "flat" | "weight" | "price";
  min?: number;
  max?: number | null;
  /** Fee in PHP for this band */
  amount: number;
}

export interface ShippingEta {
  min?: number;
  max?: number;
}

export type ShippingMethod =
  | {
      id: string;
      type: "flat" | "local_delivery";
      label?: string;
      enabled?: boolean;
      zones: ShippingZone[];
      rates: ShippingRate[];
      freeAboveSubtotal?: number;
      etaMinutes?: ShippingEta;
    }
  | {
      id: string;
      type: "pickup";
      label?: string;
      enabled?: boolean;
      instructions?: string;
      etaMinutes?: ShippingEta;
    }
  | {
      id: string;
      type: "courier";
      label?: string;
      enabled?: boolean;
      provider: ShippingCourierProvider;
      fallbackFlatRate?: number;
      freeAboveSubtotal?: number;
      serviceType?: string;
      etaMinutes?: ShippingEta;
    };

export interface ShippingProfile {
  id: string;
  name: string;
  enabled?: boolean;
  methods: ShippingMethod[];
}

export interface TenantShippingJson {
  version?: 1;
  defaultProfileId?: string;
  profiles: ShippingProfile[];
  origin?: { address?: string; lat?: number; lng?: number };
  notes?: string;
  rationale?: string;
}

export const EMPTY_SHIPPING: TenantShippingJson = {
  version: 1,
  defaultProfileId: "default",
  profiles: [
    {
      id: "default",
      name: "Default",
      enabled: true,
      methods: [
        {
          id: "flat-default",
          type: "flat",
          label: "Standard delivery",
          enabled: true,
          zones: [],
          rates: [{ id: "rate-flat", basis: "flat", amount: 89 }],
          freeAboveSubtotal: 500,
          etaMinutes: { min: 60, max: 180 },
        },
        {
          id: "pickup-default",
          type: "pickup",
          label: "Store pickup",
          enabled: true,
          instructions: "",
          etaMinutes: { min: 30, max: 60 },
        },
      ],
    },
  ],
  origin: { address: "" },
  notes: "",
};

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asId(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeZone(raw: unknown, index: number): ShippingZone | null {
  if (!raw || typeof raw !== "object") return null;
  const z = raw as Record<string, unknown>;
  const match =
    z.match && typeof z.match === "object"
      ? (z.match as ShippingZone["match"])
      : undefined;
  return {
    id: asId(z.id, `zone-${index}`),
    name: typeof z.name === "string" && z.name.trim() ? z.name.trim() : `Zone ${index + 1}`,
    match: match
      ? {
          provinces: Array.isArray(match.provinces)
            ? match.provinces.filter((x): x is string => typeof x === "string")
            : undefined,
          cities: Array.isArray(match.cities)
            ? match.cities.filter((x): x is string => typeof x === "string")
            : undefined,
          barangays: Array.isArray(match.barangays)
            ? match.barangays.filter((x): x is string => typeof x === "string")
            : undefined,
          postalPrefixes: Array.isArray(match.postalPrefixes)
            ? match.postalPrefixes.filter((x): x is string => typeof x === "string")
            : undefined,
        }
      : undefined,
  };
}

function normalizeRate(raw: unknown, index: number): ShippingRate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const basis =
    r.basis === "weight" || r.basis === "price" || r.basis === "flat" ? r.basis : "flat";
  return {
    id: asId(r.id, `rate-${index}`),
    zoneId: typeof r.zoneId === "string" ? r.zoneId : undefined,
    basis,
    min: r.min != null ? asNumber(r.min, 0) : undefined,
    max: r.max === null ? null : r.max != null ? asNumber(r.max, 0) : undefined,
    amount: Math.max(0, asNumber(r.amount, 0)),
  };
}

function normalizeMethod(raw: unknown, index: number): ShippingMethod | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const id = asId(m.id, `method-${index}`);
  const label = typeof m.label === "string" ? m.label : undefined;
  const enabled = m.enabled !== false;
  const eta =
    m.etaMinutes && typeof m.etaMinutes === "object"
      ? {
          min:
            (m.etaMinutes as ShippingEta).min != null
              ? asNumber((m.etaMinutes as ShippingEta).min, 0)
              : undefined,
          max:
            (m.etaMinutes as ShippingEta).max != null
              ? asNumber((m.etaMinutes as ShippingEta).max, 0)
              : undefined,
        }
      : undefined;

  if (m.type === "pickup") {
    return {
      id,
      type: "pickup",
      label,
      enabled,
      instructions: typeof m.instructions === "string" ? m.instructions : "",
      etaMinutes: eta,
    };
  }

  if (m.type === "courier") {
    const provider: ShippingCourierProvider =
      m.provider === "lalamove" || m.provider === "grab" || m.provider === "manual"
        ? m.provider
        : "manual";
    return {
      id,
      type: "courier",
      label,
      enabled,
      provider,
      fallbackFlatRate: asNumber(m.fallbackFlatRate, 89),
      freeAboveSubtotal:
        m.freeAboveSubtotal != null ? asNumber(m.freeAboveSubtotal, 0) : undefined,
      serviceType: typeof m.serviceType === "string" ? m.serviceType : undefined,
      etaMinutes: eta,
    };
  }

  const type = m.type === "local_delivery" ? "local_delivery" : "flat";
  const zones = Array.isArray(m.zones)
    ? m.zones.map(normalizeZone).filter((z): z is ShippingZone => !!z)
    : [];
  const rates = Array.isArray(m.rates)
    ? m.rates.map(normalizeRate).filter((r): r is ShippingRate => !!r)
    : [{ id: `rate-${id}`, basis: "flat" as const, amount: 89 }];

  return {
    id,
    type,
    label,
    enabled,
    zones,
    rates,
    freeAboveSubtotal:
      m.freeAboveSubtotal != null ? asNumber(m.freeAboveSubtotal, 0) : undefined,
    etaMinutes: eta,
  };
}

function normalizeProfile(raw: unknown, index: number): ShippingProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const methods = Array.isArray(p.methods)
    ? p.methods.map(normalizeMethod).filter((m): m is ShippingMethod => !!m)
    : [];
  if (methods.length === 0) return null;
  return {
    id: asId(p.id, `profile-${index}`),
    name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : `Profile ${index + 1}`,
    enabled: p.enabled !== false,
    methods,
  };
}

export function normalizeShippingJson(input: unknown): TenantShippingJson {
  if (!input || typeof input !== "object") return structuredClone(EMPTY_SHIPPING);
  const raw = input as Record<string, unknown>;
  const profiles = Array.isArray(raw.profiles)
    ? raw.profiles.map(normalizeProfile).filter((p): p is ShippingProfile => !!p)
    : [];
  const safeProfiles = profiles.length > 0 ? profiles : structuredClone(EMPTY_SHIPPING.profiles);
  const defaultProfileId =
    typeof raw.defaultProfileId === "string" &&
    safeProfiles.some((p) => p.id === raw.defaultProfileId)
      ? raw.defaultProfileId
      : safeProfiles[0]!.id;

  const origin =
    raw.origin && typeof raw.origin === "object"
      ? (raw.origin as TenantShippingJson["origin"])
      : EMPTY_SHIPPING.origin;

  return {
    version: 1,
    defaultProfileId,
    profiles: safeProfiles,
    origin: {
      address: typeof origin?.address === "string" ? origin.address : "",
      lat: origin?.lat != null ? asNumber(origin.lat, 0) : undefined,
      lng: origin?.lng != null ? asNumber(origin.lng, 0) : undefined,
    },
    notes: typeof raw.notes === "string" ? raw.notes : "",
    rationale: typeof raw.rationale === "string" ? raw.rationale : undefined,
  };
}

/** Seed shipping config from legacy settings_json.delivery. */
export function shippingFromLegacyDelivery(delivery: {
  provider?: ShippingCourierProvider;
  flatRate?: number;
  freeDeliveryMin?: number;
  pickupEnabled?: boolean;
  deliveryNotes?: string;
  pickupAddress?: string;
} | null | undefined): TenantShippingJson {
  const provider = delivery?.provider ?? "manual";
  const flatRate = asNumber(delivery?.flatRate, 89);
  const freeMin = asNumber(delivery?.freeDeliveryMin, 500);
  const pickupEnabled = delivery?.pickupEnabled !== false;

  const methods: ShippingMethod[] = [];
  if (provider === "lalamove" || provider === "grab") {
    methods.push({
      id: "courier-default",
      type: "courier",
      label: provider === "lalamove" ? "Lalamove" : "GrabExpress",
      enabled: true,
      provider,
      fallbackFlatRate: flatRate,
      freeAboveSubtotal: freeMin,
      etaMinutes: { min: 45, max: 120 },
    });
  } else {
    methods.push({
      id: "flat-default",
      type: "flat",
      label: "Standard delivery",
      enabled: true,
      zones: [],
      rates: [{ id: "rate-flat", basis: "flat", amount: flatRate }],
      freeAboveSubtotal: freeMin,
      etaMinutes: { min: 60, max: 180 },
    });
  }
  methods.push({
    id: "local-default",
    type: "local_delivery",
    label: "Local delivery",
    enabled: true,
    zones: [],
    rates: [{ id: "rate-local", basis: "flat", amount: flatRate }],
    freeAboveSubtotal: freeMin,
    etaMinutes: { min: 30, max: 90 },
  });
  methods.push({
    id: "pickup-default",
    type: "pickup",
    label: "Store pickup",
    enabled: pickupEnabled,
    instructions: "",
    etaMinutes: { min: 30, max: 60 },
  });

  return normalizeShippingJson({
    version: 1,
    defaultProfileId: "default",
    profiles: [{ id: "default", name: "Default", enabled: true, methods }],
    origin: { address: delivery?.pickupAddress ?? "" },
    notes: delivery?.deliveryNotes ?? "",
  });
}

/** Compact legacy delivery blob for settings_json mirror on publish. */
export function legacyDeliveryFromShipping(shipping: TenantShippingJson): {
  provider: ShippingCourierProvider;
  flatRate: number;
  freeDeliveryMin: number;
  pickupEnabled: boolean;
  deliveryNotes: string;
  pickupAddress: string;
} {
  const normalized = normalizeShippingJson(shipping);
  const profile =
    normalized.profiles.find((p) => p.id === normalized.defaultProfileId) ??
    normalized.profiles[0];
  const methods = profile?.methods ?? [];
  const courier = methods.find((m) => m.type === "courier" && m.enabled !== false);
  const flat = methods.find(
    (m) => (m.type === "flat" || m.type === "local_delivery") && m.enabled !== false
  );
  const pickup = methods.find((m) => m.type === "pickup");

  let provider: ShippingCourierProvider = "manual";
  let flatRate = 89;
  let freeDeliveryMin = 0;

  if (courier && courier.type === "courier") {
    provider = courier.provider;
    flatRate = courier.fallbackFlatRate ?? 89;
    freeDeliveryMin = courier.freeAboveSubtotal ?? 0;
  } else if (flat && (flat.type === "flat" || flat.type === "local_delivery")) {
    provider = "manual";
    const rate = flat.rates.find((r) => r.basis === "flat") ?? flat.rates[0];
    flatRate = rate?.amount ?? 89;
    freeDeliveryMin = flat.freeAboveSubtotal ?? 0;
  }

  return {
    provider,
    flatRate,
    freeDeliveryMin,
    pickupEnabled: pickup?.type === "pickup" ? pickup.enabled !== false : true,
    deliveryNotes: normalized.notes ?? "",
    pickupAddress: normalized.origin?.address ?? "",
  };
}

export interface ResolveShippingFeeInput {
  shipping: TenantShippingJson;
  subtotal: number;
  /** Optional product weight in kg for weight bands */
  weightKg?: number;
  city?: string;
  barangay?: string;
  province?: string;
  postalCode?: string;
  methodId?: string;
}

export interface ResolvedShippingFee {
  fee: number;
  methodId: string | null;
  methodType: ShippingMethod["type"] | null;
  etaMinutes: ShippingEta | null;
  free: boolean;
  provider: ShippingCourierProvider | null;
  /** The chosen method's free-delivery minimum (null = none). Phase 17b. */
  freeAbove?: number | null;
}

function zoneMatches(
  zone: ShippingZone,
  input: Pick<ResolveShippingFeeInput, "city" | "barangay" | "province" | "postalCode">
): boolean {
  const match = zone.match;
  if (!match) return true;
  const city = (input.city ?? "").toLowerCase();
  const barangay = (input.barangay ?? "").toLowerCase();
  const province = (input.province ?? "").toLowerCase();
  const postal = input.postalCode ?? "";

  const anyRule =
    (match.cities?.length ?? 0) > 0 ||
    (match.barangays?.length ?? 0) > 0 ||
    (match.provinces?.length ?? 0) > 0 ||
    (match.postalPrefixes?.length ?? 0) > 0;
  if (!anyRule) return true;

  if (match.cities?.some((c) => city.includes(c.toLowerCase()))) return true;
  if (match.barangays?.some((b) => barangay.includes(b.toLowerCase()))) return true;
  if (match.provinces?.some((p) => province.includes(p.toLowerCase()))) return true;
  if (match.postalPrefixes?.some((p) => postal.startsWith(p))) return true;
  return false;
}

function pickRateAmount(
  rates: ShippingRate[],
  zoneId: string | undefined,
  subtotal: number,
  weightKg: number
): number | null {
  const scoped = rates.filter((r) => !r.zoneId || r.zoneId === zoneId);
  const candidates = scoped.length > 0 ? scoped : rates;
  for (const rate of candidates) {
    const value = rate.basis === "weight" ? weightKg : rate.basis === "price" ? subtotal : 0;
    const min = rate.min ?? 0;
    const max = rate.max == null ? Infinity : rate.max;
    if (rate.basis === "flat") return rate.amount;
    if (value >= min && value <= max) return rate.amount;
  }
  const flat = candidates.find((r) => r.basis === "flat");
  return flat ? flat.amount : candidates[0]?.amount ?? null;
}

/** Pure fee resolver used by storefront when not using live courier quotes. */
export function resolveShippingFee(input: ResolveShippingFeeInput): ResolvedShippingFee {
  const shipping = normalizeShippingJson(input.shipping);
  const profile =
    shipping.profiles.find((p) => p.id === shipping.defaultProfileId && p.enabled !== false) ??
    shipping.profiles.find((p) => p.enabled !== false) ??
    shipping.profiles[0];

  const methods = (profile?.methods ?? []).filter((m) => m.enabled !== false);
  const method =
    (input.methodId ? methods.find((m) => m.id === input.methodId) : undefined) ??
    methods.find((m) => m.type === "courier" || m.type === "flat" || m.type === "local_delivery") ??
    methods[0] ??
    null;

  if (!method || method.type === "pickup") {
    return {
      fee: 0,
      methodId: method?.id ?? null,
      methodType: method?.type ?? null,
      etaMinutes: method && "etaMinutes" in method ? method.etaMinutes ?? null : null,
      free: true,
      provider: null,
      freeAbove: null,
    };
  }

  const freeAbove = (method.freeAboveSubtotal ?? 0) > 0 ? method.freeAboveSubtotal! : null;

  if (method.type === "courier") {
    const free =
      (method.freeAboveSubtotal ?? 0) > 0 && input.subtotal >= (method.freeAboveSubtotal ?? 0);
    return {
      fee: free ? 0 : method.fallbackFlatRate ?? 0,
      methodId: method.id,
      methodType: "courier",
      etaMinutes: method.etaMinutes ?? null,
      free,
      provider: method.provider,
      freeAbove,
    };
  }

  const free =
    (method.freeAboveSubtotal ?? 0) > 0 && input.subtotal >= (method.freeAboveSubtotal ?? 0);
  if (free) {
    return {
      fee: 0,
      methodId: method.id,
      methodType: method.type,
      etaMinutes: method.etaMinutes ?? null,
      free: true,
      provider: null,
      freeAbove,
    };
  }

  const matchingZone =
    method.zones.find((z) =>
      zoneMatches(z, {
        city: input.city,
        barangay: input.barangay,
        province: input.province,
        postalCode: input.postalCode,
      })
    ) ?? (method.zones.length === 0 ? { id: undefined as unknown as string, name: "all" } : null);

  const zoneId =
    matchingZone && "id" in matchingZone && typeof matchingZone.id === "string"
      ? matchingZone.id
      : undefined;

  const amount = pickRateAmount(
    method.rates,
    zoneId,
    input.subtotal,
    input.weightKg ?? 0
  );

  return {
    fee: Math.max(0, amount ?? 0),
    methodId: method.id,
    methodType: method.type,
    etaMinutes: method.etaMinutes ?? null,
    free: false,
    provider: null,
    freeAbove,
  };
}

/**
 * Phase 17b: the delivery fee a buyer pays. Free delivery is the seller's promise, so it wins over a
 * live courier quote (the seller absorbs the courier cost); otherwise the live quote, else the table.
 */
export function checkoutDeliveryFee(resolved: Pick<ResolvedShippingFee, "fee" | "free">, liveFee?: number | null): number {
  if (resolved.free) return 0;
  return liveFee != null && Number.isFinite(liveFee) ? Math.max(0, liveFee) : resolved.fee;
}

export interface FreeDeliveryNudge {
  threshold: number;
  /** Pesos still to add (0 once reached). */
  remaining: number;
  /** 0–1 for a progress bar. */
  progress: number;
  reached: boolean;
}

/** "Dagdagan ng ₱X para libre ang delivery" — null when the shop has no free-delivery minimum. */
export function freeDeliveryNudge(subtotal: number, freeAbove: number | null | undefined): FreeDeliveryNudge | null {
  if (!freeAbove || freeAbove <= 0 || !Number.isFinite(subtotal) || subtotal <= 0) return null;
  const remaining = Math.max(0, Math.round((freeAbove - subtotal) * 100) / 100);
  return { threshold: freeAbove, remaining, progress: Math.min(1, subtotal / freeAbove), reached: remaining === 0 };
}

export function isPickupEnabled(shipping: TenantShippingJson): boolean {
  const normalized = normalizeShippingJson(shipping);
  const profile =
    normalized.profiles.find((p) => p.id === normalized.defaultProfileId) ??
    normalized.profiles[0];
  return (
    profile?.methods.some((m) => m.type === "pickup" && m.enabled !== false) ?? false
  );
}
