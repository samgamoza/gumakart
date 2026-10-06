export interface TenantDeliverySettings {
  provider?: "lalamove" | "grab" | "manual";
  flatRate?: number;
  freeDeliveryMin?: number;
  pickupEnabled?: boolean;
  deliveryNotes?: string;
  /** Full store address used as the courier pickup point (geocoded for quotes). */
  pickupAddress?: string;
  /** Phase 24: own-delivery fee per area; anywhere else pays flatRate. */
  areaRates?: { metro_manila?: number; luzon?: number; visayas?: number; mindanao?: number };
}

export interface TenantNotificationSettings {
  emailOnNewOrder?: boolean;
  smsOnNewOrder?: boolean;
  emailOnOrderStatus?: boolean;
  marketingEmails?: boolean;
}

export interface TenantWhatsappSettings {
  enabled?: boolean;
  phone?: string;
  greeting?: string;
  connectedAt?: string;
}

export interface TenantTrackingSettings {
  facebookPixelId?: string;
  googleAnalyticsId?: string;
  tiktokPixelId?: string;
}

export interface TenantShopAssistantSettings {
  enabled?: boolean;
  name?: string;
  greeting?: string;
  tone?: "friendly_taglish" | "professional_en" | "gen_z_taglish";
  humanInbox?: boolean;
}

export interface TenantPaymentsSettings {
  mode?: "manual_ewallet" | "paymongo" | "both";
  receiving?: {
    gcashNumber?: string;
    gcashName?: string;
    mayaNumber?: string;
    mayaName?: string;
    bankName?: string;
    bankAccountName?: string;
    bankAccountNumber?: string;
  };
}

export interface TenantAgentSettings {
  postingEnabled?: boolean;
  campaignEnabled?: boolean;
  postingSchedule?: "daily" | "weekly" | "manual";
  postingTime?: string;
  weeklyDay?: number;
  channels?: Array<"instagram" | "tiktok" | "facebook">;
  lastReminderDate?: string;
}

export interface TenantWalletSettings {
  autoPayoutEnabled?: boolean;
  payoutMethod?: "gcash" | "maya" | "bank";
  payoutAccount?: string;
  payoutAccountName?: string;
  kycVerified?: boolean;
  kycStatus?: "none" | "draft" | "in_progress" | "submitted" | "approved" | "rejected";
  kycVerifiedAt?: string;
}

export interface TenantOrderRulesSettings {
  /** Unpaid orders are cancelled (stock released) after this many hours, 1–72. Default 24. */
  unpaidExpiryHours?: number;
}

/** Where the seller already sells (onboarding step 1). */
export type TenantSellChannel = "facebook" | "instagram" | "tiktok" | "messenger" | "shopee" | "lazada" | "other";

export interface TenantSocialSettings {
  sellChannels?: TenantSellChannel[];
  /** Page / chat link buyers go back to after ordering ("Back to chat"), e.g. https://m.me/yourpage. */
  chatUrl?: string;
}

export interface TenantContactSettings {
  /** Seller's mobile (09XXXXXXXXX) for order alerts. */
  mobile?: string;
}

export interface TenantOnboardingSettings {
  /** Last finished step: 1 business, 2 first product, 3 payments, 4 link. */
  step?: number;
  completedAt?: string;
  skippedAt?: string;
}

/** Automatic buyer SMS recipes (plan Phase 4). Missing key = on (default). */
export type AutomationRecipeId =
  | "order_created"
  | "payment_confirmed"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "abandoned_checkout"
  | "unpaid_reminder"
  /** Phase 23: "rate your order" text 2 days after delivery. Opt-in: missing = OFF. */
  | "review_request"
  /** Phase 13: email copies of the order texts when the buyer gave an email (missing = on). */
  | "email_copies";

export type TenantAutomationSettings = Partial<Record<AutomationRecipeId, boolean>>;

/** POS Lite tax setup (plan §12). Defaults: not VAT-registered, VAT-inclusive prices, 12%. */
export interface TenantPosSettings {
  vatRegistered?: boolean;
  vatInclusive?: boolean;
  vatRate?: number;
  /** Phase 11: BIR-ready POS (off until the owner turns it on with the shop's PTU details). */
  bir?: TenantBirSettings;
}

export interface TenantBirSettings {
  enabled?: boolean;
  registeredName?: string;
  tradeName?: string;
  tin?: string;
  branchCode?: string;
  address?: string;
  /** Machine Identification Number (MIN) from the PTU. */
  min?: string;
  serialNo?: string;
  ptuNo?: string;
  ptuDate?: string;
  /** CAS/POS accreditation number of the software provider, when issued. */
  accreditationNo?: string;
  invoicePrefix?: string;
}

/** Phase 9: stock alerts. A variant at or below the threshold counts as low. */
export interface TenantInventorySettings {
  lowStockThreshold?: number;
}

export interface TenantSettingsJson {
  pos?: TenantPosSettings;
  inventory?: TenantInventorySettings;
  automations?: TenantAutomationSettings;
  contact?: TenantContactSettings;
  social?: TenantSocialSettings;
  onboarding?: TenantOnboardingSettings;
  /** Order rules (key kept as `checkout` per the Phase 2 spec, D4). */
  checkout?: TenantOrderRulesSettings;
  codEnabled?: boolean;
  autoAcceptOrders?: boolean;
  minOrderAmount?: number;
  delivery?: TenantDeliverySettings;
  notifications?: TenantNotificationSettings;
  whatsapp?: TenantWhatsappSettings;
  tracking?: TenantTrackingSettings;
  shopAssistant?: TenantShopAssistantSettings;
  agents?: TenantAgentSettings;
  wallet?: TenantWalletSettings;
  payments?: TenantPaymentsSettings;
  /** Phase 27: Suki loyalty rules (see types/loyalty.ts). */
  loyalty?: import("./loyalty").TenantLoyaltySettings;
}

export interface TenantSettingsRecord {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  category: string | null;
  localeDefault: "en" | "fil" | "taglish" | null;
  currency: string;
  timezone: string;
  subscriptionPlan: string | null;
  status: string;
  themeJson: {
    tagline?: string;
    promoTitle?: string;
    promoSubtitle?: string;
  } | null;
  settings: TenantSettingsJson;
}

export interface UpdateTenantSettingsInput {
  name?: string;
  legalName?: string | null;
  category?: string | null;
  localeDefault?: "en" | "fil" | "taglish";
  currency?: string;
  timezone?: string;
  tagline?: string;
  promoTitle?: string;
  promoSubtitle?: string;
  subscriptionPlan?: string;
  settings?: Partial<TenantSettingsJson> & {
    delivery?: Partial<TenantDeliverySettings>;
    notifications?: Partial<TenantNotificationSettings>;
    whatsapp?: Partial<TenantWhatsappSettings>;
    tracking?: Partial<TenantTrackingSettings>;
    shopAssistant?: Partial<TenantShopAssistantSettings>;
    agents?: Partial<TenantAgentSettings>;
    wallet?: Partial<TenantWalletSettings>;
    checkout?: Partial<TenantOrderRulesSettings>;
    payments?: Partial<TenantPaymentsSettings> & {
      receiving?: Partial<NonNullable<TenantPaymentsSettings["receiving"]>>;
    };
  };
}
