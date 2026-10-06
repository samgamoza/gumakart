import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  decimal,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const localeEnum = pgEnum("locale", ["en", "fil", "taglish"]);
export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "seller_owner",
  "seller_staff",
  "customer",
  /** Phase 18: agency partner — no shop of its own; works in shops that granted access. */
  "partner",
]);
export const productStatusEnum = pgEnum("product_status", [
  "draft",
  "active",
  "archived",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "pending_payment",
  "paid",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "refunded",
]);
// Phase 2: an order is three independent facts (docs/PHASE-2-MIGRATION-SPEC.md).
export const orderStateEnum = pgEnum("order_state", ["open", "completed", "cancelled"]);
export const orderPaymentStateEnum = pgEnum("order_payment_state", [
  "unpaid",
  "pending_verification",
  "paid",
  "cod_due",
  "failed",
  "refunded",
  "partially_refunded",
]);
export const fulfillmentStateEnum = pgEnum("fulfillment_state", [
  "unfulfilled",
  "ready",
  "booked",
  "picked_up",
  "out_for_delivery",
  "delivered",
  "failed_delivery",
  "returned",
]);
export const paymentGatewayEnum = pgEnum("payment_gateway", [
  "paymongo",
  "xendit",
  "cod",
  "manual",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "processing",
  "paid",
  "failed",
  "refunded",
]);
export const deliveryProviderEnum = pgEnum("delivery_provider", [
  "lalamove",
  "grab",
  "manual",
  "bayango",
]);
export const notificationChannelEnum = pgEnum("notification_channel", [
  "sms",
  "email",
  "push",
]);

export const agentScheduleEnum = pgEnum("agent_schedule", ["daily", "weekly", "manual"]);
export const contentQueueStatusEnum = pgEnum("content_queue_status", [
  "draft",
  "approved",
  "scheduled",
  "posted",
  "skipped",
]);
export const contentPlatformEnum = pgEnum("content_platform", [
  "instagram",
  "tiktok",
  "facebook",
  "whatsapp",
]);
export const changeRequestDomainEnum = pgEnum("change_request_domain", [
  "theme",
  "pricing",
  "catalog",
  "seo",
  "checkout",
  "shipping",
]);
export const changeRequestStatusEnum = pgEnum("change_request_status", [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "published",
  "rolled_back",
]);
export const actorTypeEnum = pgEnum("actor_type", ["user", "ai", "system"]);
export const walletLedgerTypeEnum = pgEnum("wallet_ledger_type", [
  "sale_credit",
  "clearance_release",
  "payout",
  "refund_debit",
  "adjustment",
]);
export const walletLedgerStatusEnum = pgEnum("wallet_ledger_status", [
  "pending",
  "available",
  "completed",
  "cancelled",
]);
export const payoutStatusEnum = pgEnum("payout_status", [
  "queued",
  "processing",
  "completed",
  "failed",
]);
export const payoutMethodEnum = pgEnum("payout_method", ["gcash", "maya", "bank"]);
export const kycStatusEnum = pgEnum("kyc_status", [
  "draft",
  "in_progress",
  "submitted",
  "approved",
  "rejected",
]);
export const kycIdPathEnum = pgEnum("kyc_id_path", ["primary", "secondary"]);
export const kycDocTypeEnum = pgEnum("kyc_doc_type", [
  "primary_id",
  "secondary_id_1",
  "secondary_id_2",
  "selfie",
]);

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "running",
  "completed",
  "failed",
]);

// ─── Tenancy ─────────────────────────────────────────────────────────────────

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 64 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    legalName: varchar("legal_name", { length: 255 }),
    category: varchar("category", { length: 100 }),
    logoUrl: text("logo_url"),
    coverUrl: text("cover_url"),
    themeJson: jsonb("theme_json").$type<{
      templateId?: string;
      /** Paired storefront + seller-dashboard pattern (e.g. simply-sweet). */
      patternId?: "classic" | "simply-sweet" | "bloom" | "sarab" | "furnish" | "zay" | "electro" | "kaira" | "foodmart" | "stylish" | "mellow" | "organic" | "waggy" | "fruitables" | "ministore" | "aircon" | "carserv" | "motto" | "studio" | "haircut" | "specialty";
      primaryColor?: string;
      accentColor?: string;
      fontFamily?: string;
      displayFont?: "bricolage" | "system" | "mono-accent";
      /** Curated palette applied at signup or from the shop builder. */
      paletteId?: string;
      /** Brand vibe chosen at signup. */
      vibe?: string;
      tagline?: string;
      promoTitle?: string;
      promoSubtitle?: string;
      storeLook?: {
        heroLayout?: "circle" | "split" | "stack";
        marquee?: "on" | "off";
        floatCards?: "on" | "off";
        menuColumns?: "2" | "3";
        typeScale?: "classic" | "bold" | "soft";
        radiusTone?: "soft" | "sharp";
      };
      catalogId?: string;
      catalogLabel?: string;
    }>(),
    /**
     * GUMA Launch Store DNA — business profile used for template scoring.
     * Deterministic; never requires an LLM.
     */
    storeDnaJson: jsonb("store_dna_json").$type<{
      version: 1;
      businessName: string;
      category: string;
      vibe: string;
      audience?: string;
      productCountHint?: "none" | "1-10" | "11-50" | "50+";
      sellingChannels?: Array<"social" | "marketplace" | "in_person">;
      goals?: Array<"launch_fast" | "brand_look" | "conversion" | "live_selling">;
      locale: "en" | "fil" | "taglish";
      derivedAt: string;
      launchStep?: "dna" | "templates" | "personalize" | "preview" | "publish" | "done";
      selectedTemplateId?: string;
    }>(),
    /** Working draft theme (Launch personalize + Shop Builder Appearance). */
    themeDraftJson: jsonb("theme_draft_json").$type<{
      templateId?: string;
      patternId?: string;
      primaryColor?: string;
      accentColor?: string;
      fontFamily?: string;
      displayFont?: "bricolage" | "system" | "mono-accent";
      paletteId?: string;
      vibe?: string;
      tagline?: string;
      promoTitle?: string;
      promoSubtitle?: string;
      storeLook?: {
        heroLayout?: "circle" | "split" | "stack";
        marquee?: "on" | "off";
        floatCards?: "on" | "off";
        menuColumns?: "2" | "3";
        typeScale?: "classic" | "bold" | "soft";
        radiusTone?: "soft" | "sharp";
      };
      catalogId?: string;
      catalogLabel?: string;
    }>(),
    /** Buyer-facing published theme. Storefront reads this (fallback: theme_json). */
    themePublishedJson: jsonb("theme_published_json").$type<{
      templateId?: string;
      patternId?: string;
      primaryColor?: string;
      accentColor?: string;
      fontFamily?: string;
      displayFont?: "bricolage" | "system" | "mono-accent";
      paletteId?: string;
      vibe?: string;
      tagline?: string;
      promoTitle?: string;
      promoSubtitle?: string;
      storeLook?: {
        heroLayout?: "circle" | "split" | "stack";
        marquee?: "on" | "off";
        floatCards?: "on" | "off";
        menuColumns?: "2" | "3";
        typeScale?: "classic" | "bold" | "soft";
        radiusTone?: "soft" | "sharp";
      };
      catalogId?: string;
      catalogLabel?: string;
    }>(),
    customizationVersion: integer("customization_version").default(1).notNull(),
    /** Working SEO draft (Workspace SEO editor / AI suggest). */
    seoDraftJson: jsonb("seo_draft_json").$type<import("../types/tenant-seo").TenantSeoJson>(),
    /** Buyer-facing published SEO. Storefront metadata/robots/sitemap read this. */
    seoPublishedJson: jsonb("seo_published_json").$type<
      import("../types/tenant-seo").TenantSeoJson
    >(),
    /** Working checkout config draft (Workspace Checkout / AI suggest). */
    checkoutDraftJson: jsonb("checkout_draft_json").$type<
      import("../types/tenant-checkout").TenantCheckoutJson
    >(),
    /** Buyer-facing published checkout config. Storefront reads this. */
    checkoutPublishedJson: jsonb("checkout_published_json").$type<
      import("../types/tenant-checkout").TenantCheckoutJson
    >(),
    /** Working shipping config draft (Workspace Shipping / AI suggest). */
    shippingDraftJson: jsonb("shipping_draft_json").$type<
      import("../types/tenant-shipping").TenantShippingJson
    >(),
    /** Buyer-facing published shipping. Storefront reads this. */
    shippingPublishedJson: jsonb("shipping_published_json").$type<
      import("../types/tenant-shipping").TenantShippingJson
    >(),
    localeDefault: localeEnum("locale_default").default("taglish"),
    currency: varchar("currency", { length: 3 }).default("PHP").notNull(),
    timezone: varchar("timezone", { length: 64 }).default("Asia/Manila").notNull(),
    pickupAddressId: uuid("pickup_address_id"),
    settingsJson: jsonb("settings_json").$type<{
      codEnabled?: boolean;
      autoAcceptOrders?: boolean;
      minOrderAmount?: number;
      delivery?: {
        provider?: "lalamove" | "grab" | "manual";
        flatRate?: number;
        freeDeliveryMin?: number;
        pickupEnabled?: boolean;
        deliveryNotes?: string;
        pickupAddress?: string;
      };
      notifications?: {
        emailOnNewOrder?: boolean;
        smsOnNewOrder?: boolean;
        emailOnOrderStatus?: boolean;
        marketingEmails?: boolean;
      };
      whatsapp?: {
        enabled?: boolean;
        phone?: string;
        greeting?: string;
        connectedAt?: string;
      };
      tracking?: {
        facebookPixelId?: string;
        googleAnalyticsId?: string;
        tiktokPixelId?: string;
      };
      shopAssistant?: {
        enabled?: boolean;
        name?: string;
        greeting?: string;
        tone?: "friendly_taglish" | "professional_en" | "gen_z_taglish";
        /** When true, buyer messages are also visible to the seller inbox */
        humanInbox?: boolean;
      };
      payments?: {
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
      };
      agents?: {
        postingEnabled?: boolean;
        campaignEnabled?: boolean;
        postingSchedule?: "daily" | "weekly" | "manual";
        postingTime?: string;
        weeklyDay?: number;
        channels?: Array<"instagram" | "tiktok" | "facebook">;
        lastReminderDate?: string;
      };
    }>(),
    subscriptionPlan: varchar("subscription_plan", { length: 50 }).default("free"),
    /** When a PayMongo-billed plan period ends; null for free/manual plans. */
    planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
    /** Phase 17: stock is tracked per branch (location_stock) once a second branch is added. */
    branchStockEnabled: boolean("branch_stock_enabled").default(false).notNull(),
    /** Phase 18: the partner whose link the shop signed up through (for a future commission). */
    referredByPartnerId: uuid("referred_by_partner_id"),
    /** Next per-tenant order sequence number, claimed atomically at checkout. */
    nextOrderSeq: integer("next_order_seq").default(1).notNull(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("tenants_slug_idx").on(table.slug)]
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 20 }),
    passwordHash: text("password_hash"),
    role: userRoleEnum("role").default("customer").notNull(),
    /** Phase 10: for role = seller_staff — what they may do in the shop. */
    staffRole: varchar("staff_role", { length: 16 }).$type<"manager" | "staff" | "cashier">(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    profileJson: jsonb("profile_json").$type<{
      displayName?: string;
      avatarUrl?: string;
      googleId?: string;
    }>(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    // Bumping this invalidates every JWT issued before the bump (logout-all).
    sessionVersion: integer("session_version").default(0).notNull(),
    // Phase 21: two-step sign-in (TOTP). The secret is AES-GCM sealed; backup codes are HMAC hashes.
    // totpSecretSealed with no totpEnabledAt = enrollment started but not confirmed.
    totpSecretSealed: text("totp_secret_sealed"),
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
    // Last accepted 30-second step, so a code can't be used twice.
    totpLastStep: bigint("totp_last_step", { mode: "number" }),
    totpBackupCodes: jsonb("totp_backup_codes").$type<string[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    uniqueIndex("users_phone_idx").on(table.phone),
    index("users_tenant_idx").on(table.tenantId),
  ]
);

export const addresses = pgTable("addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  label: varchar("label", { length: 100 }),
  recipientName: varchar("recipient_name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  line1: text("line1").notNull(),
  line2: text("line2"),
  barangay: varchar("barangay", { length: 255 }),
  city: varchar("city", { length: 255 }).notNull(),
  province: varchar("province", { length: 255 }).notNull(),
  region: varchar("region", { length: 255 }),
  postalCode: varchar("postal_code", { length: 20 }),
  psgcCode: varchar("psgc_code", { length: 20 }),
  lat: decimal("lat", { precision: 10, scale: 7 }),
  lng: decimal("lng", { precision: 10, scale: 7 }),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * PSA PSGC master list for checkout address autosuggest
 * (province → city/municipality → barangay).
 */
export const phLocationKindEnum = pgEnum("ph_location_kind", [
  "province",
  "city",
  "barangay",
]);

export const phLocations = pgTable(
  "ph_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    psgcCode: varchar("psgc_code", { length: 20 }).notNull(),
    kind: phLocationKindEnum("kind").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    nameNormalized: varchar("name_normalized", { length: 255 }).notNull(),
    provinceCode: varchar("province_code", { length: 10 }).notNull(),
    provinceName: varchar("province_name", { length: 255 }).notNull(),
    cityCode: varchar("city_code", { length: 20 }),
    cityName: varchar("city_name", { length: 255 }),
  },
  (table) => [
    uniqueIndex("ph_locations_psgc_idx").on(table.psgcCode),
    index("ph_locations_kind_name_idx").on(table.kind, table.nameNormalized),
    index("ph_locations_province_city_idx").on(
      table.kind,
      table.provinceCode,
      table.cityCode,
      table.nameNormalized
    ),
  ]
);

// ─── Catalog ─────────────────────────────────────────────────────────────────

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    parentId: uuid("parent_id"),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    sortOrder: integer("sort_order").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("categories_tenant_idx").on(table.tenantId)]
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    title: varchar("title", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    descriptionHtml: text("description_html"),
    status: productStatusEnum("status").default("draft").notNull(),
    basePrice: decimal("base_price", { precision: 12, scale: 2 }).notNull(),
    compareAtPrice: decimal("compare_at_price", { precision: 12, scale: 2 }),
    trackInventory: boolean("track_inventory").default(true),
    allowCustomization: boolean("allow_customization").default(false),
    /** Seller identity product — one per tenant; featured on storefront. */
    isMain: boolean("is_main").default(false).notNull(),
    metadataJson: jsonb("metadata_json").$type<{
      prepTimeMinutes?: number;
      allergens?: string[];
      /** Food sell unit — pc / box / custom. */
      unitType?: "pc" | "box" | "other";
      unitCustom?: string;
      /** Service pricing chrome: base/minimum vs value range (max in compareAt). */
      servicePriceStyle?: "base_minimum" | "value_range";
    }>(),
    aiGenerated: boolean("ai_generated").default(false),
    /** Phase 9: up to 3 options, e.g. [{ name: "Size", values: ["S","M"] }]. null = no options. */
    optionsJson: jsonb("options_json").$type<Array<{ name: string; values: string[] }>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("products_tenant_status_idx").on(table.tenantId, table.status),
    uniqueIndex("products_tenant_slug_idx").on(table.tenantId, table.slug),
    index("products_tenant_main_idx").on(table.tenantId, table.isMain),
  ]
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .references(() => products.id, { onDelete: "cascade" })
      .notNull(),
    sku: varchar("sku", { length: 100 }),
    title: varchar("title", { length: 255 }).notNull(),
    price: decimal("price", { precision: 12, scale: 2 }).notNull(),
    stockQty: integer("stock_qty").default(0),
    optionsJson: jsonb("options_json").$type<Record<string, string>>(),
    imageUrl: text("image_url"),
    /** Phase 9: display order, on/off (kept for past orders), per-variant compare price and barcode. */
    position: integer("position").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    compareAtPrice: decimal("compare_at_price", { precision: 12, scale: 2 }),
    barcode: varchar("barcode", { length: 64 }),
    /** Phase 14: what the seller paid per unit (optional) — profit and stock value. */
    costPrice: decimal("cost_price", { precision: 12, scale: 2 }),
  },
  (table) => [index("product_variants_product_idx").on(table.productId)]
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .references(() => products.id, { onDelete: "cascade" })
      .notNull(),
    variantId: uuid("variant_id").references(() => productVariants.id),
    url: text("url").notNull(),
    alt: varchar("alt", { length: 255 }),
    sortOrder: integer("sort_order").default(0),
  },
  (table) => [index("product_images_product_idx").on(table.productId)]
);

// ─── Customers (shop CRM — buyer identity by phone) ──────────────────────────
// A per-tenant buyer aggregate keyed by phone (phone is identity for PH social
// commerce). Distinct from `users` (seller/platform accounts). Order counts and
// spend are computed from `orders` at read time — not denormalized here — so the
// CRM can never drift from the source of truth.
// ─── Locations (one default per shop in V1) ──────────────────────────────────

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    addressLine: text("address_line"),
    barangay: varchar("barangay", { length: 255 }),
    city: varchar("city", { length: 255 }),
    province: varchar("province", { length: 255 }),
    psgcCode: varchar("psgc_code", { length: 20 }),
    lat: decimal("lat", { precision: 10, scale: 7 }),
    lng: decimal("lng", { precision: 10, scale: 7 }),
    phone: varchar("phone", { length: 20 }),
    isDefault: boolean("is_default").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("locations_tenant_idx").on(table.tenantId),
    uniqueIndex("locations_tenant_default_idx").on(table.tenantId).where(sql`${table.isDefault}`),
  ]
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 255 }),
    firstOrderAt: timestamp("first_order_at", { withTimezone: true }),
    lastOrderAt: timestamp("last_order_at", { withTimezone: true }),
    notes: text("notes"),
    smsMarketingOptIn: boolean("sms_marketing_opt_in").default(false).notNull(),
    smsOptInAt: timestamp("sms_opt_in_at", { withTimezone: true }),
    smsOptInSource: varchar("sms_opt_in_source", { length: 40 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("customers_tenant_phone_idx").on(table.tenantId, table.phone),
    index("customers_tenant_last_order_idx").on(table.tenantId, table.lastOrderAt),
  ]
);

// ─── Orders ──────────────────────────────────────────────────────────────────

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    orderNumber: varchar("order_number", { length: 32 }).notNull(),
    customerId: uuid("customer_id").references(() => users.id),
    // Shop-CRM buyer this order belongs to (linked by phone at order time).
    customerRecordId: uuid("customer_record_id").references(() => customers.id),
    guestPhone: varchar("guest_phone", { length: 20 }),
    guestName: varchar("guest_name", { length: 255 }),
    guestEmail: varchar("guest_email", { length: 255 }),
    status: orderStatusEnum("status").default("pending_payment").notNull(),
    subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
    discount: decimal("discount", { precision: 12, scale: 2 }).default("0"),
    tax: decimal("tax", { precision: 12, scale: 2 }).default("0"),
    couponCode: varchar("coupon_code", { length: 64 }),
    deliveryFee: decimal("delivery_fee", { precision: 12, scale: 2 }).default("0"),
    serviceFee: decimal("service_fee", { precision: 12, scale: 2 }).default("0"),
    total: decimal("total", { precision: 12, scale: 2 }).notNull(),
    paymentStatus: paymentStatusEnum("payment_status").default("pending"),
    paymentMethod: varchar("payment_method", { length: 50 }),
    deliveryType: varchar("delivery_type", { length: 20 }).default("delivery"),
    deliveryAddressJson: jsonb("delivery_address_json"),
    pickupAddressId: uuid("pickup_address_id").references(() => addresses.id),
    notes: text("notes"),
    sourceChannel: varchar("source_channel", { length: 50 }),
    utmJson: jsonb("utm_json"),
    metaCartOrigin: varchar("meta_cart_origin", { length: 50 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Unguessable secret in the buyer's order link (?t=…). Order numbers are
    // sequential per shop, so the number alone must never unlock an order.
    accessToken: varchar("access_token", { length: 64 })
      .default(sql`replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')`)
      .notNull(),
    // Set once when reserved stock is put back (cancel / refund / expiry), so a
    // replayed transition can never restock twice.
    stockRestoredAt: timestamp("stock_restored_at", { withTimezone: true }),
    // Phase 2 statuses. `status` / `payment_status` above are legacy, written
    // from these by legacyStatusOf() until a later migration drops them.
    orderState: orderStateEnum("order_state"),
    paymentState: orderPaymentStateEnum("payment_state"),
    fulfillmentState: fulfillmentStateEnum("fulfillment_state"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: varchar("cancel_reason", { length: 200 }),
    locationId: uuid("location_id").references(() => locations.id),
    // Phase 3: the checkout link the order came through (source_channel = checkout_link).
    checkoutLinkId: uuid("checkout_link_id").references((): AnyPgColumn => checkoutLinks.id, {
      onDelete: "set null",
    }),
    // Phase 5 (POS Lite): the shift and cashier that rang up a POS sale (source_channel = pos).
    registerSessionId: uuid("register_session_id").references((): AnyPgColumn => registerSessions.id, {
      onDelete: "set null",
    }),
    posStaffId: uuid("pos_staff_id").references((): AnyPgColumn => posStaff.id, { onDelete: "set null" }),
    /** Client-made key per "Charge" tap; unique per tenant so a retry never makes a second sale. */
    posIdempotencyKey: varchar("pos_idempotency_key", { length: 64 }),
    /** Tenders, change, VAT breakdown, senior/PWD details, cashier name — what the receipt shows. */
    posMetaJson: jsonb("pos_meta_json"),
    /** Phase 11: seller-only note and tags (never shown to the buyer). */
    staffNote: text("staff_note"),
    tagsJson: jsonb("tags_json").$type<string[]>(),
    /** Sum of partial/whole refunds recorded through returns (pesos). */
    refundedAmount: decimal("refunded_amount", { precision: 12, scale: 2 }).default("0").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /** POS: voided within its shift (sale reversed). */
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    /** POS with BIR numbering on: the sales invoice number printed on the receipt. */
    invoiceNumber: varchar("invoice_number", { length: 32 }),
    /** Phase 12: the Guma ID buyer who placed it (verified mobile matched the order). */
    buyerAccountId: uuid("buyer_account_id").references((): AnyPgColumn => buyerAccounts.id, { onDelete: "set null" }),
    /** Phase 12b: POS sale rung while the register was offline (device clock), synced later. */
    posOfflineAt: timestamp("pos_offline_at", { withTimezone: true }),
    posDeviceId: varchar("pos_device_id", { length: 40 }),
    /** Phase 13: where the sale came from (facebook, tiktok, shopee, pos, direct…; types/sales-channel). */
    salesChannel: varchar("sales_channel", { length: 20 }),
    /** Marketplace order number (Shopee/Lazada import), unique per shop + channel. */
    externalOrderId: varchar("external_order_id", { length: 80 }),
    /** The Messenger/Instagram conversation the order link was sent in. */
    socialThreadId: uuid("social_thread_id").references((): AnyPgColumn => socialThreads.id, { onDelete: "set null" }),
    /** Phase 17: part of the total paid with a gift card / store credit (amount due = total − this). */
    giftCardAmount: decimal("gift_card_amount", { precision: 12, scale: 2 }).default("0").notNull(),
  },
  (table) => [
    uniqueIndex("orders_access_token_idx").on(table.accessToken),
    // Order numbers are unique per tenant (tracking lookups are always scoped
    // by tenant slug), which lets every shop have its own 0001, 0002, ...
    uniqueIndex("orders_tenant_number_idx").on(table.tenantId, table.orderNumber),
    index("orders_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
    index("orders_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("orders_guest_phone_idx").on(table.guestPhone),
    index("orders_tenant_states_idx").on(
      table.tenantId,
      table.orderState,
      table.paymentState,
      table.fulfillmentState
    ),
  ]
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .references(() => orders.id, { onDelete: "cascade" })
      .notNull(),
    productId: uuid("product_id").references(() => products.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    titleSnapshot: varchar("title_snapshot", { length: 255 }).notNull(),
    variantSnapshot: varchar("variant_snapshot", { length: 255 }),
    quantity: integer("quantity").notNull(),
    unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull(),
    lineTotal: decimal("line_total", { precision: 12, scale: 2 }).notNull(),
    customizationsJson: jsonb("customizations_json"),
    /** Phase 11: units returned so far (≤ quantity). */
    returnedQty: integer("returned_qty").default(0).notNull(),
    /** Phase 14: the variant's cost price when sold (null = no cost set). */
    unitCost: decimal("unit_cost", { precision: 12, scale: 2 }),
  },
  (table) => [
    index("order_items_order_idx").on(table.orderId),
    index("order_items_product_idx").on(table.productId),
  ]
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .references(() => orders.id, { onDelete: "cascade" })
      .notNull(),
    status: orderStatusEnum("status").notNull(),
    event: varchar("event", { length: 60 }),
    fromState: text("from_state"),
    toState: text("to_state"),
    note: text("note"),
    actorId: uuid("actor_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("order_status_history_order_idx").on(table.orderId)]
);

// ─── Stock ledger ────────────────────────────────────────────────────────────

export const stockMovementReasonEnum = pgEnum("stock_movement_reason", [
  "initial",
  "sale",
  "restock_cancel",
  "restock_refund",
  "restock_expiry",
  "adjustment",
  // Phase 11: order edits, returns and exchanges (may repeat per order).
  "order_edit",
  "return_restock",
  "exchange_out",
  // Phase 17: branch stock.
  "transfer_out",
  "transfer_in",
  "branch_count",
]);

/**
 * Append-only ledger: every change to product_variants.stock_qty writes one row.
 * Sum(delta) per variant reconciles to stock_qty from the moment the ledger
 * started (0020 back-fills an "initial" row with the stock at that time).
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    variantId: uuid("variant_id")
      .references(() => productVariants.id, { onDelete: "cascade" })
      .notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    reason: stockMovementReasonEnum("reason").notNull(),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after"),
    note: varchar("note", { length: 200 }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("stock_movements_variant_idx").on(table.variantId, table.createdAt),
    index("stock_movements_tenant_idx").on(table.tenantId, table.createdAt),
    index("stock_movements_order_idx").on(table.orderId),
  ]
);

// ─── Checkout links (Phase 3) ─────────────────────────────────────────────────
// A shareable one-page checkout for chosen products: kart.guma.one/c/<code>.
// Prices are always read from the variant at order time; the link only says what and how many.

export const checkoutLinks = pgTable(
  "checkout_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    code: varchar("code", { length: 16 }).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    /** Where the seller said they'll share it: facebook, instagram, tiktok, messenger, other. */
    shareChannel: varchar("share_channel", { length: 20 }),
    allowQuantityEdit: boolean("allow_quantity_edit").default(true).notNull(),
    /** both | delivery | pickup (limited further by what the shop has enabled). */
    deliveryMode: varchar("delivery_mode", { length: 12 }).default("both").notNull(),
    /** Allowed methods (subset of the shop's); null = every method the shop accepts. */
    paymentMethods: jsonb("payment_methods").$type<string[] | null>(),
    couponCode: varchar("coupon_code", { length: 64 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxOrders: integer("max_orders"),
    active: boolean("active").default(true).notNull(),
    viewCount: integer("view_count").default(0).notNull(),
    startCount: integer("start_count").default(0).notNull(),
    orderCount: integer("order_count").default(0).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("checkout_links_code_idx").on(table.code),
    index("checkout_links_tenant_idx").on(table.tenantId, table.createdAt),
  ]
);

export const checkoutLinkItems = pgTable(
  "checkout_link_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    linkId: uuid("link_id")
      .references(() => checkoutLinks.id, { onDelete: "cascade" })
      .notNull(),
    productId: uuid("product_id")
      .references(() => products.id, { onDelete: "cascade" })
      .notNull(),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    quantity: integer("quantity").default(1).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [
    index("checkout_link_items_link_idx").on(table.linkId, table.sortOrder),
    index("checkout_link_items_product_idx").on(table.productId),
  ]
);

// ─── Checkout sessions (abandoned cart / progress) ───────────────────────────

export const checkoutSessions = pgTable(
  "checkout_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    sessionKey: varchar("session_key", { length: 64 }).notNull(),
    cartJson: jsonb("cart_json"),
    customerJson: jsonb("customer_json"),
    addressJson: jsonb("address_json"),
    couponCode: varchar("coupon_code", { length: 64 }),
    status: varchar("status", { length: 32 }).default("active").notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    abandonedAt: timestamp("abandoned_at", { withTimezone: true }),
    convertedOrderId: uuid("converted_order_id"),
    phone: varchar("phone", { length: 20 }),
    marketingConsent: boolean("marketing_consent").default(false).notNull(),
    recoverySentCount: integer("recovery_sent_count").default(0).notNull(),
    lastRecoveryAt: timestamp("last_recovery_at", { withTimezone: true }),
    sourceChannel: varchar("source_channel", { length: 50 }),
    utmJson: jsonb("utm_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("checkout_sessions_tenant_key_idx").on(table.tenantId, table.sessionKey),
    index("checkout_sessions_status_idx").on(
      table.tenantId,
      table.status,
      table.lastActivityAt
    ),
  ]
);

// ─── Payments ────────────────────────────────────────────────────────────────

export const paymentTransactions = pgTable(
  "payment_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .references(() => orders.id)
      .notNull(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    gateway: paymentGatewayEnum("gateway").notNull(),
    gatewayIntentId: varchar("gateway_intent_id", { length: 255 }),
    gatewayPaymentId: varchar("gateway_payment_id", { length: 255 }),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("PHP").notNull(),
    status: paymentStatusEnum("status").default("pending").notNull(),
    methodType: varchar("method_type", { length: 50 }),
    rawWebhookJson: jsonb("raw_webhook_json"),
    reference: varchar("reference", { length: 120 }),
    proofUrl: text("proof_url"),
    verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    checkoutUrl: text("checkout_url"),
    refundId: varchar("refund_id", { length: 255 }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    failureReason: varchar("failure_reason", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("payment_intent_idx").on(table.gatewayIntentId),
    index("payment_order_idx").on(table.orderId),
  ]
);

// ─── Tenant wallet & payouts ─────────────────────────────────────────────────

export const tenantWallets = pgTable(
  "tenant_wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    availableBalance: decimal("available_balance", { precision: 12, scale: 2 })
      .default("0")
      .notNull(),
    pendingBalance: decimal("pending_balance", { precision: 12, scale: 2 })
      .default("0")
      .notNull(),
    totalWithdrawn: decimal("total_withdrawn", { precision: 12, scale: 2 })
      .default("0")
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("tenant_wallets_tenant_idx").on(table.tenantId)]
);

export const tenantPayouts = pgTable(
  "tenant_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    fee: decimal("fee", { precision: 12, scale: 2 }).default("0").notNull(),
    method: payoutMethodEnum("method").notNull(),
    destinationAccount: varchar("destination_account", { length: 64 }).notNull(),
    destinationName: varchar("destination_name", { length: 120 }).notNull(),
    status: payoutStatusEnum("status").default("queued").notNull(),
    autoTriggered: boolean("auto_triggered").default(false).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("tenant_payouts_tenant_idx").on(table.tenantId, table.createdAt),
    index("tenant_payouts_status_idx").on(table.status, table.createdAt),
  ]
);

export const walletLedgerEntries = pgTable(
  "wallet_ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    payoutId: uuid("payout_id").references(() => tenantPayouts.id),
    type: walletLedgerTypeEnum("type").notNull(),
    status: walletLedgerStatusEnum("status").notNull(),
    grossAmount: decimal("gross_amount", { precision: 12, scale: 2 }).notNull(),
    feeAmount: decimal("fee_amount", { precision: 12, scale: 2 }).default("0").notNull(),
    netAmount: decimal("net_amount", { precision: 12, scale: 2 }).notNull(),
    description: text("description"),
    availableAt: timestamp("available_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("wallet_ledger_tenant_idx").on(table.tenantId, table.createdAt),
    uniqueIndex("wallet_ledger_order_sale_idx").on(table.orderId, table.type),
    index("wallet_ledger_pending_idx").on(table.status, table.availableAt),
  ]
);

// ─── Email one-time codes ─────────────────────────────────────────────────────
// Signup verification and re-verification. code_hash = HMAC(AUTH_SECRET, email|purpose|code).

export const emailVerificationCodes = pgTable(
  "email_verification_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull(),
    purpose: varchar("purpose", { length: 24 }).notNull(),
    codeHash: varchar("code_hash", { length: 128 }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("email_codes_lookup_idx").on(table.email, table.purpose, table.createdAt)]
);

// ─── KYC verification ────────────────────────────────────────────────────────

export const kycVerificationSessions = pgTable(
  "kyc_verification_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    token: varchar("token", { length: 64 }).notNull(),
    status: kycStatusEnum("status").default("draft").notNull(),
    idPath: kycIdPathEnum("id_path"),
    primaryIdType: varchar("primary_id_type", { length: 64 }),
    secondaryIdType1: varchar("secondary_id_type_1", { length: 64 }),
    secondaryIdType2: varchar("secondary_id_type_2", { length: 64 }),
    rejectionReason: text("rejection_reason"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("kyc_sessions_token_idx").on(table.token),
    index("kyc_sessions_tenant_idx").on(table.tenantId, table.createdAt),
  ]
);

export const kycDocuments = pgTable(
  "kyc_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .references(() => kycVerificationSessions.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    docType: kycDocTypeEnum("doc_type").notNull(),
    idCategory: varchar("id_category", { length: 64 }),
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    mimeType: varchar("mime_type", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("kyc_documents_session_type_idx").on(table.sessionId, table.docType),
    index("kyc_documents_tenant_idx").on(table.tenantId),
  ]
);

// ─── Delivery ────────────────────────────────────────────────────────────────

export const deliveryQuotes = pgTable(
  "delivery_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").references(() => orders.id),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    provider: deliveryProviderEnum("provider").notNull(),
    quoteId: varchar("quote_id", { length: 255 }),
    fee: decimal("fee", { precision: 12, scale: 2 }),
    currency: varchar("currency", { length: 3 }).default("PHP"),
    etaMinutes: integer("eta_minutes"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    rawResponseJson: jsonb("raw_response_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("delivery_quotes_order_idx").on(table.orderId)]
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .references(() => orders.id)
      .notNull(),
    quoteId: uuid("quote_id").references(() => deliveryQuotes.id),
    provider: deliveryProviderEnum("provider").notNull(),
    providerOrderId: varchar("provider_order_id", { length: 255 }),
    status: varchar("status", { length: 50 }),
    driverName: varchar("driver_name", { length: 255 }),
    driverPhone: varchar("driver_phone", { length: 20 }),
    driverPlateNumber: varchar("driver_plate_number", { length: 20 }),
    /** Last known courier location pushed by the provider webhook. */
    driverLat: decimal("driver_lat", { precision: 10, scale: 7 }),
    driverLng: decimal("driver_lng", { precision: 10, scale: 7 }),
    driverLocationAt: timestamp("driver_location_at", { withTimezone: true }),
    trackingUrl: text("tracking_url"),
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    pickupLocationId: uuid("pickup_location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("deliveries_order_idx").on(table.orderId),
    index("deliveries_provider_order_idx").on(table.providerOrderId),
  ]
);

// ─── Billing & notifications ─────────────────────────────────────────────────

/** One row per PayMongo plan payment; unique intent id keeps the webhook idempotent. */
export const planPayments = pgTable(
  "plan_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    plan: varchar("plan", { length: 50 }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("PHP").notNull(),
    gateway: paymentGatewayEnum("gateway").default("paymongo").notNull(),
    gatewayIntentId: varchar("gateway_intent_id", { length: 255 }),
    status: paymentStatusEnum("status").default("pending").notNull(),
    periodDays: integer("period_days").default(30).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** Phase 16: GK-2026-000001, set when paid (payment receipt, not a BIR official receipt). */
    receiptNumber: varchar("receipt_number", { length: 24 }),
  },
  (table) => [
    uniqueIndex("plan_payments_intent_idx").on(table.gatewayIntentId),
    uniqueIndex("plan_payments_receipt_idx").on(table.receiptNumber),
    index("plan_payments_tenant_idx").on(table.tenantId),
  ]
);

/** Web Push subscriptions for seller notifications (VAPID). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    userId: uuid("user_id").references(() => users.id),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: varchar("user_agent", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
    index("push_subscriptions_tenant_idx").on(table.tenantId),
  ]
);

// ─── Messaging ───────────────────────────────────────────────────────────────

export type MessageChannel = "sms" | "messenger" | "email" | "push";
export type MessageStatus = "queued" | "sent" | "delivered" | "failed" | "suppressed";

/** Every outbound message, every channel. idempotency_key = `${recipe}:${entity}:${step}`. */
export const messageLog = pgTable(
  "message_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    channel: varchar("channel", { length: 20 }).$type<MessageChannel>().notNull(),
    recipient: varchar("recipient", { length: 255 }).notNull(),
    recipe: varchar("recipe", { length: 80 }).notNull(),
    step: integer("step").default(0).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    status: varchar("status", { length: 20 }).$type<MessageStatus>().default("queued").notNull(),
    suppressedReason: varchar("suppressed_reason", { length: 80 }),
    provider: varchar("provider", { length: 40 }),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    body: text("body"),
    segments: integer("segments"),
    costCentavos: integer("cost_centavos"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("message_log_idempotency_idx").on(table.idempotencyKey),
    index("message_log_tenant_idx").on(table.tenantId, table.createdAt),
    index("message_log_order_idx").on(table.orderId),
    index("message_log_recipient_idx").on(table.recipient, table.createdAt),
  ]
);

/** STOP list. tenant_id NULL = every shop (one platform sender — decision D3). */
export const messagingOptOuts = pgTable("messaging_opt_outs", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: varchar("phone", { length: 20 }).notNull(),
  channel: varchar("channel", { length: 20 }).default("sms").notNull(),
  scope: varchar("scope", { length: 20 }).$type<"marketing" | "all">().default("marketing").notNull(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 20 }).default("STOP").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── AI & Content ────────────────────────────────────────────────────────────

export const aiGenerations = pgTable("ai_generations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id)
    .notNull(),
  userId: uuid("user_id").references(() => users.id),
  templateKey: varchar("template_key", { length: 100 }).notNull(),
  inputPrompt: text("input_prompt").notNull(),
  outputJson: jsonb("output_json"),
  model: varchar("model", { length: 100 }),
  tokensUsed: integer("tokens_used"),
  appliedToProductId: uuid("applied_to_product_id").references(() => products.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contentQueue = pgTable(
  "content_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    agentKey: varchar("agent_key", { length: 50 }).notNull(),
    platform: contentPlatformEnum("platform").notNull(),
    title: varchar("title", { length: 255 }),
    body: text("body").notNull(),
    mediaBrief: text("media_brief"),
    status: contentQueueStatusEnum("status").default("draft").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    outputJson: jsonb("output_json"),
    flagged: boolean("flagged").default(false).notNull(),
    moderationNote: text("moderation_note"),
    moderatedBy: uuid("moderated_by").references(() => users.id),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("content_queue_tenant_idx").on(table.tenantId),
    index("content_queue_status_idx").on(table.status),
    index("content_queue_flagged_idx").on(table.flagged),
  ]
);

// ─── Platform administration ─────────────────────────────────────────────────

export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    actorType: actorTypeEnum("actor_type").default("user"),
    actorId: uuid("actor_id").references(() => users.id),
    actorEmail: varchar("actor_email", { length: 255 }),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    entityId: uuid("entity_id"),
    entityLabel: varchar("entity_label", { length: 255 }),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("platform_audit_actor_idx").on(table.actorId),
    index("platform_audit_created_idx").on(table.createdAt),
    index("platform_audit_entity_idx").on(table.entityType, table.entityId),
    index("platform_audit_tenant_idx").on(table.tenantId, table.createdAt),
  ]
);

/** AI / seller proposed changes — draft → approve → publish (Crown Jewel). */
export const changeRequests = pgTable(
  "change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    domain: changeRequestDomainEnum("domain").notNull(),
    status: changeRequestStatusEnum("status").default("draft").notNull(),
    scope: varchar("scope", { length: 60 }).notNull(),
    approvalLevel: varchar("approval_level", { length: 20 }).notNull(),
    proposedByType: actorTypeEnum("proposed_by_type").notNull(),
    proposedByUserId: uuid("proposed_by_user_id").references(() => users.id),
    aiGenerationId: uuid("ai_generation_id").references(() => aiGenerations.id),
    summary: varchar("summary", { length: 255 }),
    beforeJson: jsonb("before_json").$type<Record<string, unknown> | null>(),
    afterJson: jsonb("after_json").$type<Record<string, unknown> | null>(),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("change_requests_tenant_idx").on(table.tenantId),
    index("change_requests_status_idx").on(table.status),
    index("change_requests_tenant_status_idx").on(table.tenantId, table.status),
  ]
);

/** Append-only domain event log (Phase 2 — Inngest + local replay). */
export const domainEvents = pgTable(
  "domain_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    eventName: varchar("event_name", { length: 120 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    correlationId: varchar("correlation_id", { length: 64 }),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // Outbox: rows written inside a transaction stay unpublished until the
    // relay hands them to Inngest (id = idempotency key, so retries dedupe).
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    uniqueIndex("domain_events_idempotency_uidx").on(table.idempotencyKey),
    index("domain_events_tenant_idx").on(table.tenantId, table.createdAt),
    index("domain_events_name_idx").on(table.eventName, table.createdAt),
  ]
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    agentKey: varchar("agent_key", { length: 50 }).notNull(),
    status: agentRunStatusEnum("status").default("running").notNull(),
    itemsCreated: integer("items_created").default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("agent_runs_tenant_idx").on(table.tenantId)]
);

export const shopChatMessages = pgTable(
  "shop_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    sessionId: varchar("session_id", { length: 64 }).notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("shop_chat_tenant_session_idx").on(table.tenantId, table.sessionId),
    index("shop_chat_tenant_created_idx").on(table.tenantId, table.createdAt),
  ]
);

export const aiUsageMonthly = pgTable(
  "ai_usage_monthly",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    periodMonth: varchar("period_month", { length: 7 }).notNull(),
    generations: integer("generations").default(0).notNull(),
    tokensUsed: integer("tokens_used").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_usage_tenant_month_idx").on(table.tenantId, table.periodMonth),
  ]
);

/** Global platform-wide key/value settings, controlled by super-admins.
    e.g. key "active_landing" -> "frontend1" | "frontend2". */
export const platformSettings = pgTable("platform_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Platform helpdesk ───────────────────────────────────────────────────────

export const supportTicketStatusEnum = pgEnum("support_ticket_status", [
  "open",
  "pending",
  "in_progress",
  "resolved",
  "closed",
]);
export const supportTicketPriorityEnum = pgEnum("support_ticket_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);
export const supportTicketChannelEnum = pgEnum("support_ticket_channel", [
  "web_contact",
  "seller_admin",
  "buyer_order",
  "internal",
]);
export const supportRequesterTypeEnum = pgEnum("support_requester_type", [
  "anonymous",
  "seller_user",
  "buyer",
]);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketNumber: varchar("ticket_number", { length: 24 }).notNull(),
    channel: supportTicketChannelEnum("channel").notNull(),
    requesterType: supportRequesterTypeEnum("requester_type").notNull(),
    requesterName: varchar("requester_name", { length: 160 }),
    requesterEmail: varchar("requester_email", { length: 255 }),
    requesterPhone: varchar("requester_phone", { length: 40 }),
    userId: uuid("user_id").references(() => users.id),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    orderId: uuid("order_id").references(() => orders.id),
    subject: varchar("subject", { length: 200 }).notNull(),
    category: varchar("category", { length: 64 }).notNull().default("general"),
    priority: supportTicketPriorityEnum("priority").notNull().default("normal"),
    status: supportTicketStatusEnum("status").notNull().default("open"),
    assigneeId: uuid("assignee_id").references(() => users.id),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    slaFirstResponseDueAt: timestamp("sla_first_response_due_at", { withTimezone: true }),
    slaResolveDueAt: timestamp("sla_resolve_due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("support_tickets_number_idx").on(table.ticketNumber),
    index("support_tickets_status_idx").on(table.status),
    index("support_tickets_tenant_idx").on(table.tenantId),
    index("support_tickets_assignee_idx").on(table.assigneeId),
    index("support_tickets_created_idx").on(table.createdAt),
  ]
);

export const supportTicketMessages = pgTable(
  "support_ticket_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .references(() => supportTickets.id, { onDelete: "cascade" })
      .notNull(),
    authorType: varchar("author_type", { length: 32 }).notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id),
    authorName: varchar("author_name", { length: 160 }),
    body: text("body").notNull(),
    isInternal: boolean("is_internal").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("support_ticket_messages_ticket_idx").on(table.ticketId, table.createdAt)]
);

// ─── Template Intelligence (ops-managed categories + stock) ───────────────────

export const shopCategoryStatusEnum = pgEnum("shop_category_status", [
  "enabled",
  "disabled",
]);

export const templateStockStatusEnum = pgEnum("template_stock_status", [
  "draft",
  "approved",
  "published",
  "archived",
]);

export const templateStockSourceEnum = pgEnum("template_stock_source", [
  "free_bundle",
  "ops_manual",
  "ai_curated",
]);

/** Business categories shown in seller onboarding / Launch DNA. Ops-managed. */
export const shopBusinessCategories = pgTable(
  "shop_business_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 80 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    /** Null = top-level vertical; set = subcategory under another category. */
    parentId: uuid("parent_id").references((): AnyPgColumn => shopBusinessCategories.id, {
      onDelete: "set null",
    }),
    status: shopCategoryStatusEnum("status").default("enabled").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    /** Minimum distinct skins ops aims for (default 3). */
    minVariants: integer("min_variants").default(3).notNull(),
    /** Comfortable stock target (default 5). */
    targetVariants: integer("target_variants").default(5).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("shop_business_categories_slug_idx").on(table.slug),
    uniqueIndex("shop_business_categories_label_idx").on(table.label),
    index("shop_business_categories_status_sort_idx").on(table.status, table.sortOrder),
    index("shop_business_categories_parent_idx").on(table.parentId),
  ]
);

/**
 * Ops / AI curated storefront skins beyond the Free Bundle code catalog.
 * Published rows appear in Launch for the matching category.
 */
export const templateStock = pgTable(
  "template_stock",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stockKey: varchar("stock_key", { length: 80 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    categoryId: uuid("category_id").references(() => shopBusinessCategories.id, {
      onDelete: "set null",
    }),
    categoryLabel: varchar("category_label", { length: 120 }).notNull(),
    liveTemplateId: varchar("live_template_id", { length: 64 }).notNull(),
    status: templateStockStatusEnum("status").default("draft").notNull(),
    source: templateStockSourceEnum("source").default("ops_manual").notNull(),
    sourceRef: varchar("source_ref", { length: 120 }),
    notes: text("notes"),
    previewImageUrl: text("preview_image_url"),
    storeLookJson: jsonb("store_look_json").$type<{
      heroLayout?: "circle" | "split" | "stack";
      marquee?: "on" | "off";
      floatCards?: "on" | "off";
      menuColumns?: "2" | "3";
      typeScale?: "classic" | "bold" | "soft";
      radiusTone?: "soft" | "sharp";
      /** Visible on all renderers (seeded stock skins). */
      primaryColor?: string;
      accentColor?: string;
      displayFont?: "bricolage" | "system" | "mono-accent";
      radius?: string;
      paletteId?: string;
    }>(),
    createdByUserId: uuid("created_by_user_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("template_stock_key_idx").on(table.stockKey),
    index("template_stock_category_status_idx").on(table.categoryLabel, table.status),
  ]
);

/** Lightweight learning log for Template Intelligence (selections, seeds, publishes). */
export const templateIntelligenceEvents = pgTable(
  "template_intelligence_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    categoryLabel: varchar("category_label", { length: 120 }),
    stockKey: varchar("stock_key", { length: 80 }),
    tenantId: uuid("tenant_id"),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("template_intelligence_events_type_idx").on(table.eventType, table.createdAt)]
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const tenantsRelations = relations(tenants, ({ many }) => ({
  products: many(products),
  orders: many(orders),
  users: many(users),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  tenant: one(tenants, { fields: [products.tenantId], references: [tenants.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  variants: many(productVariants),
  images: many(productImages),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [orders.tenantId], references: [tenants.id] }),
  items: many(orderItems),
  payments: many(paymentTransactions),
  delivery: one(deliveries),
}));

// ─── POS Lite (Phase 5) ──────────────────────────────────────────────────────

export const posStaff = pgTable("pos_staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 60 }).notNull(),
  role: varchar("role", { length: 16 }).$type<"cashier" | "manager">().default("cashier").notNull(),
  /** Phase 10: the staff account this PIN unlocks for (quick unlock). Null = PIN-only cashier. */
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  pinHash: varchar("pin_hash", { length: 255 }).notNull(),
  /** Bumped on PIN reset / deactivation so open cashier sessions stop working. */
  pinVersion: integer("pin_version").default(1).notNull(),
  active: boolean("active").default(true).notNull(),
  failedAttempts: integer("failed_attempts").default(0).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const registers = pgTable("registers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" })
    .notNull(),
  locationId: uuid("location_id")
    .references(() => locations.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 60 }).default("Register 1").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const registerSessions = pgTable("register_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" })
    .notNull(),
  registerId: uuid("register_id")
    .references(() => registers.id, { onDelete: "cascade" })
    .notNull(),
  status: varchar("status", { length: 12 }).$type<"open" | "closed">().default("open").notNull(),
  openingCash: decimal("opening_cash", { precision: 12, scale: 2 }).default("0").notNull(),
  openedByStaffId: uuid("opened_by_staff_id").references(() => posStaff.id, { onDelete: "set null" }),
  openedByUserId: uuid("opened_by_user_id").references(() => users.id, { onDelete: "set null" }),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  closedByStaffId: uuid("closed_by_staff_id").references(() => posStaff.id, { onDelete: "set null" }),
  closedByUserId: uuid("closed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  expectedJson: jsonb("expected_json"),
  countedJson: jsonb("counted_json"),
  varianceJson: jsonb("variance_json"),
  closeNote: text("close_note"),
});

// ─── Phase 10: staff & activity ──────────────────────────────────────────────

export const staffInvites = pgTable(
  "staff_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 80 }),
    staffRole: varchar("staff_role", { length: 16 }).$type<"manager" | "staff" | "cashier">().notNull(),
    /** sha256 of the invite token; the token itself is only shown once. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("staff_invites_token_idx").on(table.tokenHash),
    index("staff_invites_tenant_idx").on(table.tenantId, table.createdAt),
  ]
);

/** Who did what in a shop (payments confirmed, prices/stock changed, refunds, staff changes…). */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorName: varchar("actor_name", { length: 80 }).notNull(),
    actorRole: varchar("actor_role", { length: 16 }),
    action: varchar("action", { length: 48 }).notNull(),
    entityType: varchar("entity_type", { length: 24 }),
    entityId: varchar("entity_id", { length: 64 }),
    summary: varchar("summary", { length: 300 }).notNull(),
    metaJson: jsonb("meta_json").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("activity_log_tenant_idx").on(table.tenantId, table.createdAt)]
);

// ─── Phase 11: after-sale & BIR-ready POS ────────────────────────────────────

export interface OrderReturnItem {
  orderItemId: string;
  variantId: string | null;
  title: string;
  qty: number;
  unitPrice: number;
  restock: boolean;
  /** Exchange: the replacement variant handed to the buyer. */
  replacementVariantId?: string | null;
  replacementTitle?: string | null;
  replacementUnitPrice?: number | null;
}

export const orderReturns = pgTable(
  "order_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    orderId: uuid("order_id")
      .references(() => orders.id, { onDelete: "cascade" })
      .notNull(),
    kind: varchar("kind", { length: 16 }).$type<"return" | "exchange" | "void" | "edit">().notNull(),
    itemsJson: jsonb("items_json").$type<OrderReturnItem[]>().notNull(),
    refundAmount: decimal("refund_amount", { precision: 12, scale: 2 }).default("0").notNull(),
    collectedAmount: decimal("collected_amount", { precision: 12, scale: 2 }).default("0").notNull(),
    refundMethod: varchar("refund_method", { length: 16 }).notNull(),
    gatewayRefundId: varchar("gateway_refund_id", { length: 255 }),
    note: varchar("note", { length: 300 }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorName: varchar("actor_name", { length: 80 }).notNull(),
    posStaffId: uuid("pos_staff_id").references(() => posStaff.id, { onDelete: "set null" }),
    registerSessionId: uuid("register_session_id").references(() => registerSessions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("order_returns_order_idx").on(table.tenantId, table.orderId)]
);

export const posInvoiceCounters = pgTable("pos_invoice_counters", {
  registerId: uuid("register_id")
    .primaryKey()
    .references(() => registers.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" })
    .notNull(),
  prefix: varchar("prefix", { length: 12 }).default("").notNull(),
  nextInvoice: bigint("next_invoice", { mode: "number" }).default(1).notNull(),
  nextZ: integer("next_z").default(1).notNull(),
  grandTotal: decimal("grand_total", { precision: 16, scale: 2 }).default("0").notNull(),
  lastZAt: timestamp("last_z_at", { withTimezone: true }),
});

export const posZReadings = pgTable(
  "pos_z_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    registerId: uuid("register_id")
      .references(() => registers.id, { onDelete: "cascade" })
      .notNull(),
    zNumber: integer("z_number").notNull(),
    fromAt: timestamp("from_at", { withTimezone: true }),
    toAt: timestamp("to_at", { withTimezone: true }).notNull(),
    fromInvoice: varchar("from_invoice", { length: 32 }),
    toInvoice: varchar("to_invoice", { length: 32 }),
    totalsJson: jsonb("totals_json").$type<Record<string, number>>().notNull(),
    grandTotalBefore: decimal("grand_total_before", { precision: 16, scale: 2 }).notNull(),
    grandTotalAfter: decimal("grand_total_after", { precision: 16, scale: 2 }).notNull(),
    createdByName: varchar("created_by_name", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("pos_z_readings_number_idx").on(table.registerId, table.zNumber)]
);

// ─── Phase 12b: POS offline ──────────────────────────────────────────────────

/** BIR on: invoice numbers reserved by one device for receipts printed while offline. */
export const posInvoiceBlocks = pgTable(
  "pos_invoice_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    registerId: uuid("register_id")
      .references(() => registers.id, { onDelete: "cascade" })
      .notNull(),
    deviceId: varchar("device_id", { length: 40 }).notNull(),
    prefix: varchar("prefix", { length: 12 }).default("").notNull(),
    startNo: bigint("start_no", { mode: "number" }).notNull(),
    endNo: bigint("end_no", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedByName: varchar("released_by_name", { length: 80 }),
  },
  (table) => [index("pos_invoice_blocks_device_idx").on(table.tenantId, table.registerId, table.deviceId)]
);

export const POS_SYNC_ISSUE_KINDS = [
  "stock_short",
  "price_changed",
  "unavailable",
  "invoice_reassigned",
  "closed_shift",
  "after_z",
  "rejected",
] as const;
export type PosSyncIssueKind = (typeof POS_SYNC_ISSUE_KINDS)[number];

/** What an offline sale needs the owner to look at after it synced. */
export const posSyncIssues = pgTable(
  "pos_sync_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 24 }).$type<PosSyncIssueKind>().notNull(),
    message: varchar("message", { length: 300 }).notNull(),
    detailJson: jsonb("detail_json").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByName: varchar("resolved_by_name", { length: 80 }),
  },
  (table) => [index("pos_sync_issues_open_idx").on(table.tenantId, table.createdAt)]
);

// ─── Phase 13: channels ──────────────────────────────────────────────────────

export type SocialPlatform = "messenger" | "instagram";
export type ChannelAccountStatus = "connected" | "mock" | "error" | "disconnected";

/** A connected Facebook Page (Messenger) or Instagram professional account. */
export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    platform: varchar("platform", { length: 16 }).$type<SocialPlatform>().notNull(),
    /** Page id (Messenger) or Instagram account id — what webhooks address. */
    externalId: varchar("external_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    /** Instagram: the Facebook Page it's linked to (sends go through the Page). */
    pageId: varchar("page_id", { length: 64 }),
    /** Page access token, sealed (AES-GCM). Null for mock accounts. */
    accessTokenSealed: text("access_token_sealed"),
    status: varchar("status", { length: 16 }).$type<ChannelAccountStatus>().default("connected").notNull(),
    lastError: varchar("last_error", { length: 300 }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("social_accounts_external_idx").on(table.platform, table.externalId), index("social_accounts_tenant_idx").on(table.tenantId)]
);

export const socialThreads = pgTable(
  "social_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    accountId: uuid("account_id")
      .references(() => socialAccounts.id, { onDelete: "cascade" })
      .notNull(),
    platform: varchar("platform", { length: 16 }).$type<SocialPlatform>().notNull(),
    /** PSID (Messenger) / IGSID (Instagram) — page-scoped buyer id. */
    externalUserId: varchar("external_user_id", { length: 64 }).notNull(),
    buyerName: varchar("buyer_name", { length: 160 }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Meta's 24-hour rule: replies are allowed within 24 h of the buyer's last message. */
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).defaultNow().notNull(),
    lastPreview: varchar("last_preview", { length: 200 }),
    unread: integer("unread").default(0).notNull(),
    status: varchar("status", { length: 12 }).$type<"open" | "done">().default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("social_threads_user_idx").on(table.accountId, table.externalUserId),
    index("social_threads_inbox_idx").on(table.tenantId, table.status, table.lastMessageAt),
  ]
);

export const socialMessages = pgTable(
  "social_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    threadId: uuid("thread_id")
      .references(() => socialThreads.id, { onDelete: "cascade" })
      .notNull(),
    direction: varchar("direction", { length: 4 }).$type<"in" | "out">().notNull(),
    kind: varchar("kind", { length: 12 }).$type<"text" | "link" | "product" | "image" | "other">().default("text").notNull(),
    body: text("body").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>(),
    externalMessageId: varchar("external_message_id", { length: 160 }),
    status: varchar("status", { length: 12 }).$type<"received" | "sent" | "mock" | "failed">().default("sent").notNull(),
    error: varchar("error", { length: 300 }),
    sentByName: varchar("sent_by_name", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("social_messages_thread_idx").on(table.threadId, table.createdAt)]
);

export type MarketplacePlatform = "shopee" | "lazada";

/** A connected Shopee / Lazada shop. */
export const marketplaceAccounts = pgTable(
  "marketplace_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    platform: varchar("platform", { length: 12 }).$type<MarketplacePlatform>().notNull(),
    shopExternalId: varchar("shop_external_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    region: varchar("region", { length: 4 }).default("PH").notNull(),
    /** {accessToken, refreshToken}, sealed (AES-GCM). Null for mock accounts. */
    tokensSealed: text("tokens_sealed"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    status: varchar("status", { length: 16 }).$type<ChannelAccountStatus>().default("connected").notNull(),
    syncStock: boolean("sync_stock").default(true).notNull(),
    importOrders: boolean("import_orders").default(true).notNull(),
    lastStockPushAt: timestamp("last_stock_push_at", { withTimezone: true }),
    lastOrderPullAt: timestamp("last_order_pull_at", { withTimezone: true }),
    ordersCursorAt: timestamp("orders_cursor_at", { withTimezone: true }),
    lastError: varchar("last_error", { length: 300 }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("marketplace_accounts_external_idx").on(table.platform, table.shopExternalId), index("marketplace_accounts_tenant_idx").on(table.tenantId)]
);

/** One marketplace item/model, linked to the Guma variant whose stock it mirrors. */
export const marketplaceListings = pgTable(
  "marketplace_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    accountId: uuid("account_id")
      .references(() => marketplaceAccounts.id, { onDelete: "cascade" })
      .notNull(),
    externalItemId: varchar("external_item_id", { length: 64 }).notNull(),
    /** Shopee model id / Lazada SkuId; '' when the item has no models. */
    externalModelId: varchar("external_model_id", { length: 64 }).default("").notNull(),
    externalSku: varchar("external_sku", { length: 120 }),
    title: varchar("title", { length: 300 }).notNull(),
    price: decimal("price", { precision: 12, scale: 2 }),
    externalStock: integer("external_stock"),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    lastPushedQty: integer("last_pushed_qty"),
    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
    pushError: varchar("push_error", { length: 300 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("marketplace_listings_external_idx").on(table.accountId, table.externalItemId, table.externalModelId)]
);

// ─── Phase 14: SMS campaigns ─────────────────────────────────────────────────

export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled";

export const smsCampaigns = pgTable(
  "sms_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    segmentJson: jsonb("segment_json").$type<Record<string, unknown>>().notNull(),
    body: varchar("body", { length: 480 }).notNull(),
    status: varchar("status", { length: 12 }).$type<CampaignStatus>().default("draft").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    recipients: integer("recipients").default(0).notNull(),
    sent: integer("sent").default(0).notNull(),
    failed: integer("failed").default(0).notNull(),
    suppressed: integer("suppressed").default(0).notNull(),
    createdByName: varchar("created_by_name", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("sms_campaigns_tenant_idx").on(table.tenantId, table.createdAt)]
);

export const smsCampaignRecipients = pgTable(
  "sms_campaign_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .references(() => smsCampaigns.id, { onDelete: "cascade" })
      .notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    phone: varchar("phone", { length: 20 }).notNull(),
    name: varchar("name", { length: 255 }),
    status: varchar("status", { length: 12 }).$type<"queued" | "sent" | "failed" | "suppressed">().default("queued").notNull(),
    error: varchar("error", { length: 300 }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("sms_campaign_recipients_phone_idx").on(table.campaignId, table.phone), index("sms_campaign_recipients_queue_idx").on(table.campaignId, table.status)]
);

// ─── Phase 15: platform (API keys, webhooks) ────────────────────────────────

/** A shop's API key. Only the SHA-256 of the key is stored; the key is shown once. */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    tokenPrefix: varchar("token_prefix", { length: 20 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    scopes: text("scopes").array().notNull(),
    createdByName: varchar("created_by_name", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("api_tokens_hash_idx").on(table.tokenHash), index("api_tokens_tenant_idx").on(table.tenantId, table.createdAt)]
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    url: varchar("url", { length: 500 }).notNull(),
    description: varchar("description", { length: 120 }),
    events: text("events").array().notNull(),
    /** Signing secret, sealed with token-box (AES-GCM). */
    secretSealed: varchar("secret_sealed", { length: 300 }).notNull(),
    active: boolean("active").default(true).notNull(),
    consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
    disabledReason: varchar("disabled_reason", { length: 200 }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    createdByName: varchar("created_by_name", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("webhook_endpoints_tenant_idx").on(table.tenantId)]
);

/** Written by DB triggers (migration 0033) in the same transaction as the change. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    event: varchar("event", { length: 40 }).notNull(),
    entityType: varchar("entity_type", { length: 20 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    /** Frozen when the event is fanned out, so every endpoint and retry gets the same body. */
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    fannedOutAt: timestamp("fanned_out_at", { withTimezone: true }),
  },
  (table) => [index("webhook_events_tenant_idx").on(table.tenantId, table.createdAt), index("webhook_events_created_idx").on(table.createdAt)]
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    endpointId: uuid("endpoint_id")
      .references(() => webhookEndpoints.id, { onDelete: "cascade" })
      .notNull(),
    eventId: uuid("event_id")
      .references(() => webhookEvents.id, { onDelete: "cascade" })
      .notNull(),
    status: varchar("status", { length: 12 }).$type<"pending" | "succeeded" | "failed">().default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow(),
    lastStatusCode: integer("last_status_code"),
    lastError: varchar("last_error", { length: 300 }),
    responseMs: integer("response_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("webhook_deliveries_unique_idx").on(table.endpointId, table.eventId),
    index("webhook_deliveries_endpoint_idx").on(table.endpointId, table.createdAt),
  ]
);

// ─── Phase 16: operations ────────────────────────────────────────────────────

/** One row per cron job run (written by /api/cron/ops from the cron worker). Kept 14 days. */
export const cronRuns = pgTable(
  "cron_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: varchar("job", { length: 80 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    ok: boolean("ok").notNull(),
    statusCode: integer("status_code"),
    summary: varchar("summary", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("cron_runs_job_idx").on(table.job, table.startedAt), index("cron_runs_started_idx").on(table.startedAt)]
);

/** Server errors grouped by fingerprint (app + route + message). */
export const appErrors = pgTable(
  "app_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    app: varchar("app", { length: 16 }).notNull(),
    route: varchar("route", { length: 200 }),
    message: varchar("message", { length: 500 }).notNull(),
    stack: text("stack"),
    count: integer("count").default(1).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("app_errors_fingerprint_idx").on(table.fingerprint), index("app_errors_last_seen_idx").on(table.lastSeenAt)]
);

export const opsAlerts = pgTable(
  "ops_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: varchar("key", { length: 80 }).notNull(),
    severity: varchar("severity", { length: 10 }).$type<"warning" | "critical">().notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    detail: varchar("detail", { length: 1000 }),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (table) => [index("ops_alerts_opened_idx").on(table.openedAt)]
);

export type IncidentImpact = "minor" | "major" | "maintenance";
export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";

export const statusIncidents = pgTable(
  "status_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 160 }).notNull(),
    impact: varchar("impact", { length: 12 }).$type<IncidentImpact>().notNull(),
    status: varchar("status", { length: 14 }).$type<IncidentStatus>().default("investigating").notNull(),
    components: text("components").array().notNull(),
    createdBy: varchar("created_by", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [index("status_incidents_created_idx").on(table.createdAt)]
);

export const statusIncidentUpdates = pgTable(
  "status_incident_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id")
      .references(() => statusIncidents.id, { onDelete: "cascade" })
      .notNull(),
    status: varchar("status", { length: 14 }).$type<IncidentStatus>().notNull(),
    message: varchar("message", { length: 1000 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("status_incident_updates_incident_idx").on(table.incidentId, table.createdAt)]
);

/** Plan reminders/expiry/downgrade notices — one per tenant, kind and billing period. */
export const billingNotices = pgTable(
  "billing_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    kind: varchar("kind", { length: 16 }).$type<"reminder_7" | "reminder_3" | "reminder_1" | "expired" | "downgraded">().notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    plan: varchar("plan", { length: 50 }).notNull(),
    emailSent: boolean("email_sent").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("billing_notices_unique_idx").on(table.tenantId, table.kind, table.periodEnd)]
);

// ─── Phase 17: gift cards, store credit, branch stock ───────────────────────

export const giftCards = pgTable(
  "gift_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    code: varchar("code", { length: 24 }).notNull(),
    kind: varchar("kind", { length: 14 }).$type<"gift_card" | "store_credit">().default("gift_card").notNull(),
    initialAmount: decimal("initial_amount", { precision: 12, scale: 2 }).notNull(),
    balance: decimal("balance", { precision: 12, scale: 2 }).notNull(),
    status: varchar("status", { length: 10 }).$type<"active" | "disabled">().default("active").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    recipientName: varchar("recipient_name", { length: 120 }),
    note: varchar("note", { length: 200 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdByName: varchar("created_by_name", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("gift_cards_tenant_code_idx").on(table.tenantId, table.code), index("gift_cards_customer_idx").on(table.customerId)]
);

export const giftCardTxns = pgTable(
  "gift_card_txns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .references(() => giftCards.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    kind: varchar("kind", { length: 10 }).$type<"issue" | "redeem" | "restore" | "adjust">().notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    balanceAfter: decimal("balance_after", { precision: 12, scale: 2 }).notNull(),
    note: varchar("note", { length: 200 }),
    actorName: varchar("actor_name", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("gift_card_txns_card_idx").on(table.cardId, table.createdAt), index("gift_card_txns_order_idx").on(table.orderId)]
);

/** Stock per branch; kept equal to product_variants.stock_qty in total by a DB trigger (0035). */
export const locationStock = pgTable(
  "location_stock",
  {
    locationId: uuid("location_id")
      .references(() => locations.id, { onDelete: "cascade" })
      .notNull(),
    variantId: uuid("variant_id")
      .references(() => productVariants.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    qty: integer("qty").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.locationId, table.variantId] }), index("location_stock_variant_idx").on(table.variantId), index("location_stock_tenant_idx").on(table.tenantId)]
);

// ─── Phase 12: Guma ID ───────────────────────────────────────────────────────

export const buyerAccounts = pgTable(
  "buyer_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 09XXXXXXXXX, verified by SMS code. */
    phone: varchar("phone", { length: 11 }).notNull(),
    name: varchar("name", { length: 120 }),
    email: varchar("email", { length: 255 }),
    preferredPayment: varchar("preferred_payment", { length: 20 }),
    sessionVersion: integer("session_version").default(0).notNull(),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("buyer_accounts_phone_idx").on(table.phone)]
);

export interface BuyerAddressJson {
  line1: string;
  regionCode?: string;
  region?: string;
  provinceCode?: string;
  province?: string;
  cityCode?: string;
  city?: string;
  barangay?: string;
  landmark?: string;
}

export const buyerAddresses = pgTable(
  "buyer_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buyerId: uuid("buyer_id")
      .references(() => buyerAccounts.id, { onDelete: "cascade" })
      .notNull(),
    label: varchar("label", { length: 40 }),
    recipient: varchar("recipient", { length: 120 }),
    addressJson: jsonb("address_json").$type<BuyerAddressJson>().notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("buyer_addresses_buyer_idx").on(table.buyerId)]
);

export const buyerOtpCodes = pgTable(
  "buyer_otp_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: varchar("phone", { length: 11 }).notNull(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ip: varchar("ip", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("buyer_otp_codes_phone_idx").on(table.phone, table.createdAt)]
);

/** Phase 18: agency partners (their own login; status set by Guma Kart ops). */
export const partners = pgTable(
  "partners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    code: varchar("code", { length: 16 }).notNull(),
    contactEmail: varchar("contact_email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    website: varchar("website", { length: 255 }),
    city: varchar("city", { length: 120 }),
    about: varchar("about", { length: 500 }),
    status: varchar("status", { length: 12 }).$type<"pending" | "active" | "suspended">().default("pending").notNull(),
    statusNote: varchar("status_note", { length: 300 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("partners_user_idx").on(table.userId), uniqueIndex("partners_code_idx").on(table.code)]
);

/** Phase 18: a partner's link to a shop — by referral and/or an owner's access grant. */
export const partnerShops = pgTable(
  "partner_shops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id")
      .references(() => partners.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    source: varchar("source", { length: 10 }).$type<"referral" | "grant">().notNull(),
    accessRole: varchar("access_role", { length: 10 }).$type<"manager" | "staff">(),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("partner_shops_pair_idx").on(table.partnerId, table.tenantId),
    index("partner_shops_tenant_idx").on(table.tenantId),
  ]
);

// ─── Phase 27: Suki loyalty ──────────────────────────────────────────────────

/** One row per points movement; a buyer's balance is the sum. See types/loyalty.ts for the rules. */
export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    customerId: uuid("customer_id")
      .references(() => customers.id, { onDelete: "cascade" })
      .notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    kind: varchar("kind", { length: 8 }).$type<"earn" | "reverse" | "redeem" | "adjust">().notNull(),
    points: integer("points").notNull(),
    tier: varchar("tier", { length: 10 }),
    earnAmount: decimal("earn_amount", { precision: 12, scale: 2 }),
    giftCardId: uuid("gift_card_id").references(() => giftCards.id, { onDelete: "set null" }),
    note: varchar("note", { length: 200 }),
    actorName: varchar("actor_name", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("loyalty_ledger_customer_idx").on(table.tenantId, table.customerId)]
);

