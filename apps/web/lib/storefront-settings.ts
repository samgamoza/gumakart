import {
  checkoutFromLegacySettings,
  normalizeCheckoutJson,
  type TenantCheckoutJson,
} from "@gumakart/db/checkout";
import {
  isPickupEnabled,
  legacyDeliveryFromShipping,
  normalizeShippingJson,
  resolveShippingFee,
  shippingFromLegacyDelivery,
  type TenantShippingJson,
} from "@gumakart/db/shipping";

export interface StorefrontStoreSettings {
  codEnabled: boolean;
  minOrderAmount: number;
  autoAcceptOrders: boolean;
  currency: string;
  delivery: {
    provider: "lalamove" | "grab" | "manual";
    flatRate: number;
    freeDeliveryMin: number;
    pickupEnabled: boolean;
    deliveryNotes: string;
    pickupAddress: string;
  };
  whatsapp: {
    enabled: boolean;
    phone: string;
    greeting: string;
  };
  tracking: {
    facebookPixelId: string;
    googleAnalyticsId: string;
    tiktokPixelId: string;
  };
  shopAssistant: {
    enabled: boolean;
    name: string;
    greeting: string;
    tone: "friendly_taglish" | "professional_en" | "gen_z_taglish";
    humanInbox: boolean;
  };
  checkout: TenantCheckoutJson;
  shipping: TenantShippingJson;
  payments: {
    mode: "manual_ewallet" | "paymongo" | "both";
    receiving: {
      gcashNumber: string;
      gcashName: string;
      mayaNumber: string;
      mayaName: string;
      bankName: string;
      bankAccountName: string;
      bankAccountNumber: string;
    };
  };
}

export const DEFAULT_STOREFRONT_SETTINGS: StorefrontStoreSettings = {
  codEnabled: true,
  minOrderAmount: 99,
  autoAcceptOrders: false,
  currency: "PHP",
  delivery: {
    provider: "manual",
    flatRate: 89,
    freeDeliveryMin: 500,
    pickupEnabled: true,
    deliveryNotes: "",
    pickupAddress: "",
  },
  whatsapp: {
    enabled: false,
    phone: "",
    greeting: "Hi! Thanks for messaging us. Place your order here:",
  },
  tracking: {
    facebookPixelId: "",
    googleAnalyticsId: "",
    tiktokPixelId: "",
  },
  shopAssistant: {
    enabled: true,
    name: "Shop chat",
    greeting:
      "Hi! Message the seller about products, payment, or changes. Quick answers can help with hours and delivery — the shop confirms payments.",
    tone: "friendly_taglish",
    humanInbox: true,
  },
  checkout: checkoutFromLegacySettings({
    codEnabled: true,
    minOrderAmount: 99,
    autoAcceptOrders: false,
  }),
  shipping: shippingFromLegacyDelivery({
    provider: "manual",
    flatRate: 89,
    freeDeliveryMin: 500,
    pickupEnabled: true,
  }),
  payments: {
    mode: "manual_ewallet",
    receiving: {
      gcashNumber: "",
      gcashName: "",
      mayaNumber: "",
      mayaName: "",
      bankName: "",
      bankAccountName: "",
      bankAccountNumber: "",
    },
  },
};

type SettingsJson = {
  codEnabled?: boolean;
  autoAcceptOrders?: boolean;
  minOrderAmount?: number;
  delivery?: Partial<StorefrontStoreSettings["delivery"]>;
  whatsapp?: Partial<StorefrontStoreSettings["whatsapp"]>;
  tracking?: Partial<StorefrontStoreSettings["tracking"]>;
  shopAssistant?: Partial<StorefrontStoreSettings["shopAssistant"]>;
  payments?: {
    mode?: StorefrontStoreSettings["payments"]["mode"];
    receiving?: Partial<StorefrontStoreSettings["payments"]["receiving"]>;
  };
};

export function resolveStorefrontSettings(
  settingsJson?: SettingsJson | null,
  currency = "PHP",
  checkoutPublishedJson?: TenantCheckoutJson | null,
  shippingPublishedJson?: TenantShippingJson | null
): StorefrontStoreSettings {
  const defaults = DEFAULT_STOREFRONT_SETTINGS;
  const checkout = checkoutPublishedJson
    ? normalizeCheckoutJson(checkoutPublishedJson)
    : checkoutFromLegacySettings(settingsJson);
  const shipping = shippingPublishedJson
    ? normalizeShippingJson(shippingPublishedJson)
    : shippingFromLegacyDelivery(settingsJson?.delivery);
  const mirrored = legacyDeliveryFromShipping(shipping);
  const receiving = settingsJson?.payments?.receiving;

  return {
    codEnabled: checkout.codEnabled ?? settingsJson?.codEnabled ?? defaults.codEnabled,
    minOrderAmount:
      checkout.minOrderAmount ?? settingsJson?.minOrderAmount ?? defaults.minOrderAmount,
    autoAcceptOrders:
      checkout.autoAcceptOrders ??
      settingsJson?.autoAcceptOrders ??
      defaults.autoAcceptOrders,
    currency,
    delivery: {
      provider: mirrored.provider,
      flatRate: mirrored.flatRate,
      freeDeliveryMin: mirrored.freeDeliveryMin,
      pickupEnabled: isPickupEnabled(shipping),
      deliveryNotes: mirrored.deliveryNotes || (settingsJson?.delivery?.deliveryNotes ?? ""),
      pickupAddress: mirrored.pickupAddress || (settingsJson?.delivery?.pickupAddress ?? ""),
    },
    whatsapp: {
      enabled: settingsJson?.whatsapp?.enabled ?? defaults.whatsapp.enabled,
      phone: settingsJson?.whatsapp?.phone ?? defaults.whatsapp.phone,
      greeting: settingsJson?.whatsapp?.greeting ?? defaults.whatsapp.greeting,
    },
    tracking: {
      facebookPixelId:
        settingsJson?.tracking?.facebookPixelId ?? defaults.tracking.facebookPixelId,
      googleAnalyticsId:
        settingsJson?.tracking?.googleAnalyticsId ?? defaults.tracking.googleAnalyticsId,
      tiktokPixelId: settingsJson?.tracking?.tiktokPixelId ?? defaults.tracking.tiktokPixelId,
    },
    shopAssistant: {
      enabled: settingsJson?.shopAssistant?.enabled ?? defaults.shopAssistant.enabled,
      name: settingsJson?.shopAssistant?.name ?? defaults.shopAssistant.name,
      greeting: settingsJson?.shopAssistant?.greeting ?? defaults.shopAssistant.greeting,
      tone: settingsJson?.shopAssistant?.tone ?? defaults.shopAssistant.tone,
      humanInbox: settingsJson?.shopAssistant?.humanInbox !== false,
    },
    checkout,
    shipping,
    payments: {
      mode: settingsJson?.payments?.mode ?? defaults.payments.mode,
      receiving: {
        gcashNumber: receiving?.gcashNumber ?? "",
        gcashName: receiving?.gcashName ?? "",
        mayaNumber: receiving?.mayaNumber ?? "",
        mayaName: receiving?.mayaName ?? "",
        bankName: receiving?.bankName ?? "",
        bankAccountName: receiving?.bankAccountName ?? "",
        bankAccountNumber: receiving?.bankAccountNumber ?? "",
      },
    },
  };
}

export function computeDeliveryFee(
  subtotal: number,
  settings: StorefrontStoreSettings,
  address?: { city?: string; barangay?: string; province?: string; postalCode?: string }
): number {
  const resolved = resolveShippingFee({
    shipping: settings.shipping,
    subtotal,
    city: address?.city,
    barangay: address?.barangay,
    province: address?.province,
    postalCode: address?.postalCode,
  });
  return resolved.fee;
}

/** Phase 17b: the resolved shipping (fee, free flag, free minimum) for this cart and address. */
export function resolveDelivery(
  subtotal: number,
  settings: StorefrontStoreSettings,
  address?: { city?: string; barangay?: string; province?: string; postalCode?: string }
) {
  return resolveShippingFee({
    shipping: settings.shipping,
    subtotal,
    city: address?.city,
    barangay: address?.barangay,
    province: address?.province,
    postalCode: address?.postalCode,
  });
}

export function deliveryProviderLabel(provider: StorefrontStoreSettings["delivery"]["provider"]) {
  switch (provider) {
    case "lalamove":
      return "Lalamove delivery";
    case "grab":
      return "GrabExpress delivery";
    default:
      return "Delivery fee";
  }
}

export function whatsappChatUrl(phone: string, text?: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  const url = new URL(`https://wa.me/${digits}`);
  if (text?.trim()) url.searchParams.set("text", text.trim());
  return url.toString();
}
