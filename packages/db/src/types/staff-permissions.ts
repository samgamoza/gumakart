/**
 * Phase 10 — what each shop role may do. Pure (no DB), shared by the admin API guard,
 * the admin navigation and the tests.
 *
 *  owner    everything (the shop's account holder)
 *  manager  runs the shop day to day: everything except billing/payouts, payment
 *           settings and staff
 *  staff    orders and packing, products (view), checkout links, customers, chat, POS
 *  cashier  POS only
 *
 * Enforcement is server-side: every seller API call goes through requireTenantSession,
 * which looks the request up in API_RULES. A path no rule matches is OWNER-ONLY, so a
 * new route is safe until someone decides who may use it.
 */

export const STAFF_ROLES = ["manager", "staff", "cashier"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type ShopRole = "owner" | StaffRole;

export const PERMISSIONS = [
  "dashboard.view",
  "orders.view",
  "orders.fulfil",
  "orders.payments",
  "orders.cancel",
  "orders.refund",
  "orders.edit",
  "products.view",
  "products.edit",
  "stock.adjust",
  "links.manage",
  "customers.view",
  "messages.reply",
  "marketing.manage",
  "settings.shop",
  "settings.payments",
  "billing.manage",
  "pos.use",
  "pos.manage",
  "staff.manage",
  "activity.view",
  /** Phase 14: sales/profit reports and exports (owner + manager). */
  "reports.view",
  /** Phase 15: API keys and webhooks — they reach all shop data, so owner only. */
  "developers.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OWNER_ONLY: Permission[] = ["settings.payments", "billing.manage", "staff.manage", "developers.manage"];

export const ROLE_PERMISSIONS: Record<ShopRole, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  manager: new Set(PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p))),
  staff: new Set<Permission>([
    "dashboard.view",
    "orders.view",
    "orders.fulfil",
    "products.view",
    "links.manage",
    "customers.view",
    "messages.reply",
    "pos.use",
  ]),
  cashier: new Set<Permission>(["pos.use"]),
};

export const ROLE_LABELS: Record<ShopRole, { label: string; description: string }> = {
  owner: { label: "Owner", description: "Everything, including billing, payouts and staff." },
  manager: {
    label: "Manager",
    description: "Runs the shop: orders, payments, refunds, products, stock, settings, POS. No billing, payouts or staff.",
  },
  staff: {
    label: "Staff",
    description: "Packs and ships orders, makes checkout links, answers chats, sells on POS. Can't confirm payments or change prices.",
  },
  cashier: { label: "Cashier", description: "POS only." },
};

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/**
 * The shop role of a seller-app session. Owners and super-admins on support access act
 * as owner; a seller_staff account without a valid staff_role gets nothing.
 */
export function shopRoleOf(user: { role: string; staffRole?: string | null; supportAccess?: boolean }): ShopRole | null {
  if (user.role === "seller_owner" || user.role === "super_admin") return "owner";
  if (user.role === "seller_staff" && isStaffRole(user.staffRole)) return user.staffRole;
  return null;
}

export function can(role: ShopRole | null | undefined, permission: Permission): boolean {
  return role ? ROLE_PERMISSIONS[role].has(permission) : false;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface ApiRule {
  pattern: RegExp;
  /** Omitted = any method. */
  methods?: Method[];
  permission: Permission | "any";
}

const READ: Method[] = ["GET"];
const WRITE: Method[] = ["POST", "PUT", "PATCH", "DELETE"];
const ID = "[^/]+";

/** First match wins. Order specific paths before their parents. */
export const API_RULES: ApiRule[] = [
  // Everyone signed in to the shop (shell, notifications, help, sign out).
  { pattern: /^\/api\/auth\//, permission: "any" },
  { pattern: /^\/api\/push\/subscribe$/, permission: "any" },
  { pattern: /^\/api\/support\/tickets$/, permission: "any" },

  { pattern: /^\/api\/dashboard\//, permission: "dashboard.view" },
  { pattern: /^\/api\/plan$/, methods: READ, permission: "dashboard.view" },
  { pattern: /^\/api\/shop$/, methods: READ, permission: "dashboard.view" },
  { pattern: /^\/api\/settings$/, methods: READ, permission: "dashboard.view" },

  // Orders
  { pattern: new RegExp(`^/api/orders/${ID}/confirm-payment$`), permission: "orders.payments" },
  { pattern: new RegExp(`^/api/orders/${ID}/refund$`), permission: "orders.refund" },
  { pattern: new RegExp(`^/api/orders/${ID}/(assign-rider|book-delivery)$`), permission: "orders.fulfil" },
  // Phase 11: notes/tags are packing work; edits change money; returns refund.
  { pattern: new RegExp(`^/api/orders/${ID}/notes$`), permission: "orders.fulfil" },
  { pattern: new RegExp(`^/api/orders/${ID}/after-sale$`), methods: READ, permission: "orders.view" },
  { pattern: new RegExp(`^/api/orders/${ID}/edit$`), permission: "orders.edit" },
  { pattern: new RegExp(`^/api/orders/${ID}/returns$`), permission: "orders.refund" },
  { pattern: /^\/api\/orders\/(tags|slips)$/, methods: READ, permission: "orders.view" },
  // PATCH actions: cancel / reject_payment are checked again inside the route.
  { pattern: new RegExp(`^/api/orders/${ID}$`), methods: ["PATCH"], permission: "orders.fulfil" },
  { pattern: /^\/api\/orders(\/[^/]+)?$/, methods: READ, permission: "orders.view" },

  // Catalog and stock
  { pattern: new RegExp(`^/api/products/${ID}/stock-movements$`), methods: READ, permission: "products.view" },
  { pattern: new RegExp(`^/api/products/${ID}/variants$`), methods: READ, permission: "products.view" },
  { pattern: /^\/api\/products$/, methods: READ, permission: "products.view" },
  { pattern: /^\/api\/products(\/|$)/, permission: "products.edit" },
  { pattern: /^\/api\/categories$/, methods: READ, permission: "products.view" },
  { pattern: /^\/api\/categories$/, methods: WRITE, permission: "products.edit" },
  { pattern: /^\/api\/inventory\/(count|import)$/, permission: "stock.adjust" },
  { pattern: /^\/api\/inventory\/cost$/, permission: "products.edit" },
  { pattern: /^\/api\/inventory(\/export)?$/, methods: READ, permission: "products.view" },

  // Selling
  { pattern: /^\/api\/checkout-links(\/|$)/, permission: "links.manage" },
  { pattern: /^\/api\/customers(\/|$)/, permission: "customers.view" },
  { pattern: /^\/api\/messages(\/|$)/, permission: "messages.reply" },
  // Phase 13: Messenger / Instagram inbox (reply, send links) and channel setup.
  { pattern: /^\/api\/inbox(\/|$)/, permission: "messages.reply" },
  { pattern: /^\/api\/channels\/summary$/, methods: READ, permission: "dashboard.view" },
  { pattern: /^\/api\/channels(\/|$)/, permission: "settings.shop" },

  // POS (the register itself also accepts a cashier PIN cookie; see lib/pos-auth)
  { pattern: /^\/api\/pos-staff(\/|$)/, permission: "pos.manage" },
  { pattern: /^\/api\/bir(\/|$)/, permission: "pos.manage" },
  { pattern: /^\/api\/pos\/device$/, permission: "pos.manage" },
  { pattern: /^\/api\/pos\//, permission: "pos.use" },

  // Marketing and AI
  { pattern: /^\/api\/(automations|agents|ai|seo|change-requests)(\/|$)/, permission: "marketing.manage" },
  // Phase 14
  { pattern: /^\/api\/reports(\/|$)/, permission: "reports.view" },
  { pattern: /^\/api\/(discounts|campaigns)(\/|$)/, permission: "marketing.manage" },
  { pattern: /^\/api\/developers(\/|$)/, permission: "developers.manage" },
  { pattern: /^\/api\/gift-cards(\/|$)/, permission: "orders.payments" },
  { pattern: /^\/api\/branches(\/|$)/, permission: "settings.shop" },
  { pattern: /^\/api\/inventory\/(branches|transfer)(\/|$)/, permission: "stock.adjust" },
  { pattern: /^\/api\/integrations(\/|$)/, permission: "settings.shop" },

  // Shop setup
  { pattern: /^\/api\/onboarding\/payments$/, permission: "settings.payments" },
  { pattern: /^\/api\/settings$/, methods: WRITE, permission: "settings.shop" },
  {
    pattern: /^\/api\/(shop|shipping|checkout|launch|storefront-preview|onboarding|health)(\/|$)/,
    permission: "settings.shop",
  },

  // Money and the account
  { pattern: /^\/api\/(billing|wallet|kyc)(\/|$)/, permission: "billing.manage" },

  // Team
  { pattern: /^\/api\/staff(\/|$)/, permission: "staff.manage" },
  { pattern: /^\/api\/activity$/, permission: "activity.view" },
];

/** The permission an API request needs, or "owner" when no rule covers it. */
export function permissionForApi(pathname: string, method: string): Permission | "any" | "owner" {
  const m = method.toUpperCase() as Method;
  for (const rule of API_RULES) {
    if (rule.methods && !rule.methods.includes(m)) continue;
    if (rule.pattern.test(pathname)) return rule.permission;
  }
  return "owner";
}

export function canUseApi(role: ShopRole | null, pathname: string, method: string): boolean {
  if (!role) return false;
  if (role === "owner") return true;
  const needed = permissionForApi(pathname, method);
  if (needed === "owner") return false;
  if (needed === "any") return true;
  return can(role, needed);
}

/** Admin pages → the permission needed to open them (for nav and page guards). */
export const PAGE_PERMISSIONS: Array<{ prefix: string; permission: Permission }> = [
  { prefix: "/settings/staff", permission: "staff.manage" },
  // Phase 18: who may work in the shop is the owner's call (partners included).
  { prefix: "/settings/partner", permission: "staff.manage" },
  { prefix: "/settings/activity", permission: "activity.view" },
  { prefix: "/settings/payments", permission: "settings.payments" },
  { prefix: "/settings/pos", permission: "pos.manage" },
  { prefix: "/settings/subscription", permission: "billing.manage" },
  { prefix: "/settings/wallet", permission: "billing.manage" },
  { prefix: "/settings/kyc", permission: "billing.manage" },
  { prefix: "/settings", permission: "settings.shop" },
  { prefix: "/orders", permission: "orders.view" },
  { prefix: "/products", permission: "products.view" },
  { prefix: "/inventory", permission: "products.view" },
  { prefix: "/categories", permission: "products.view" },
  { prefix: "/checkout-links", permission: "links.manage" },
  { prefix: "/customers", permission: "customers.view" },
  { prefix: "/messages", permission: "messages.reply" },
  { prefix: "/inbox", permission: "messages.reply" },
  { prefix: "/channels", permission: "settings.shop" },
  { prefix: "/automations", permission: "marketing.manage" },
  { prefix: "/reports", permission: "reports.view" },
  { prefix: "/discounts", permission: "marketing.manage" },
  { prefix: "/campaigns", permission: "marketing.manage" },
  { prefix: "/developers", permission: "developers.manage" },
  { prefix: "/gift-cards", permission: "orders.payments" },
  { prefix: "/integrations", permission: "settings.shop" },
  { prefix: "/agents", permission: "marketing.manage" },
  { prefix: "/ai-studio", permission: "marketing.manage" },
  { prefix: "/workspace", permission: "marketing.manage" },
  { prefix: "/shop-builder", permission: "settings.shop" },
  { prefix: "/launch", permission: "settings.shop" },
  { prefix: "/onboarding", permission: "settings.shop" },
  { prefix: "/kyc", permission: "billing.manage" },
  { prefix: "/pos", permission: "pos.use" },
  { prefix: "/dashboard", permission: "dashboard.view" },
];

/** Pages every shop member may open (their own account, help). */
const OPEN_PAGES = ["/settings/account", "/settings/support", "/verify-email", "/help"];

export function canOpenPage(role: ShopRole | null, pathname: string): boolean {
  if (!role) return false;
  if (role === "owner") return true;
  if (OPEN_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  if (pathname === "/") return can(role, "dashboard.view");
  const rule = PAGE_PERMISSIONS.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  return rule ? can(role, rule.permission) : false;
}

/** Where a role lands after sign-in. */
export function homeFor(role: ShopRole | null): string {
  return role === "cashier" ? "/pos" : "/";
}
