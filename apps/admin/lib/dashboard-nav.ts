import type { LucideIcon } from "lucide-react";
import {
  BadgePercent,
  Star,
  Blocks,
  Code2,
  MapPin,
  Gift,
  LifeBuoy,
  BarChart3,
  Megaphone,
  Boxes,
  Bot,
  Calculator,
  Database,
  LayoutDashboard,
  Link2,
  MessageCircle,
  MessagesSquare,
  Share2,
  Package,
  Send,
  Settings,
  ShoppingBag,
  Sparkles,
  Store,
  Truck,
  Users,
  Handshake,
} from "lucide-react";
import type { SubscriptionPlan } from "@/lib/plan-access";

export interface DashboardNavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  minPlan?: SubscriptionPlan;
  badge?: "new";
  description?: string;
}

export interface DashboardNavGroup {
  id: string;
  label: string;
  items: DashboardNavItem[];
  collapsible?: boolean;
  defaultOpen?: boolean;
}

/**
 * Seller navigation, grouped by how often a social seller needs each page:
 *   1. Daily work (always visible): Overview, Orders, Checkout links, Products, Chats, Customers.
 *   2. Delivery, POS & store: visible so couriers, POS and the optional online store are easy to find.
 *   3. Less frequent tools fold away (they open automatically when you're on one of their pages).
 * Every href is unchanged; staff only see what their role can open (canOpenPage).
 */
export const DASHBOARD_NAV: DashboardNavGroup[] = [
  {
    id: "home",
    label: "",
    items: [
      {
        id: "overview",
        label: "Overview",
        href: "/",
        icon: LayoutDashboard,
        description: "What needs you today: orders to confirm, pack and ship.",
      },
      {
        id: "orders",
        label: "Orders",
        href: "/orders",
        icon: ShoppingBag,
        description: "Confirm payments, pack, and ship orders.",
      },
      {
        id: "checkout-links",
        label: "Checkout links",
        href: "/checkout-links",
        icon: Link2,
        description: "Share a one-page checkout in your posts and chats.",
      },
      {
        id: "products",
        label: "Products",
        href: "/products",
        icon: Package,
        description: "Your catalog, photos, prices, and stock.",
      },
      {
        id: "inbox",
        label: "Chats",
        href: "/inbox",
        icon: MessageCircle,
        description: "Messenger and Instagram messages — reply and send products or checkout links.",
      },
      {
        id: "customers",
        label: "Customers",
        href: "/customers",
        icon: Users,
        description: "Every buyer by phone number, with their orders.",
      },
    ],
  },
  {
    id: "fulfill",
    label: "Delivery, POS & store",
    items: [
      {
        id: "deliveries",
        label: "Deliveries",
        href: "/orders?tab=shipping",
        icon: Truck,
        description: "Orders with a rider booked or on the way.",
      },
      {
        id: "pos",
        label: "POS (in-store)",
        href: "/pos",
        icon: Calculator,
        description: "Sell in-store: cash, GCash, Maya, card; Senior/PWD; shifts.",
      },
      {
        id: "launch",
        label: "Online store",
        href: "/launch",
        icon: Store,
        description: "Optional: a full shop page with your look and products.",
      },
      {
        id: "integrations",
        label: "Apps & integrations",
        href: "/integrations",
        icon: Blocks,
        description: "Payments, chats, Shopee/Lazada, couriers, pixels, Zapier and more — what's on and what to set up.",
      },
    ],
  },
  {
    id: "sell",
    label: "Catalog & insights",
    collapsible: true,
    defaultOpen: false,
    items: [
      {
        id: "inventory",
        label: "Stock",
        href: "/inventory",
        icon: Boxes,
        description: "Count stock, low-stock alerts, CSV import and export.",
      },
      {
        id: "categories",
        label: "Categories",
        href: "/categories",
        icon: Database,
        description: "Group products for your online store.",
      },
      {
        id: "reports",
        label: "Reports",
        href: "/reports",
        icon: BarChart3,
        description: "Sales, profit, top products and buyers, repeat rate — with CSV exports.",
      },
      {
        id: "channels",
        label: "Sales channels",
        href: "/channels",
        icon: Share2,
        description: "Sales by channel, TikTok/Facebook/Instagram links, Messenger, Shopee and Lazada.",
      },
      {
        id: "reviews",
        label: "Reviews",
        href: "/reviews",
        icon: Star,
        description: "Verified buyer reviews: reply, hide or report.",
      },
    ],
  },
  {
    id: "automate",
    label: "Messages & promos",
    collapsible: true,
    defaultOpen: false,
    items: [
      {
        id: "automations",
        label: "Auto SMS",
        href: "/automations",
        icon: Send,
        description: "Order updates and reminders texted to buyers for you.",
      },
      {
        id: "messages",
        label: "AI assistant chats",
        href: "/messages",
        icon: MessagesSquare,
        description: "Your AI shop assistant's chats with store visitors.",
      },
      {
        id: "campaigns",
        label: "SMS campaigns",
        href: "/campaigns",
        icon: Megaphone,
        description: "Text a sale to buyers who said yes — repeat buyers, VIPs, people who haven't ordered lately.",
      },
      {
        id: "discounts",
        label: "Discounts",
        href: "/discounts",
        icon: BadgePercent,
        description: "Coupon codes, quantity deals and automatic discounts.",
      },
      {
        id: "gift-cards",
        label: "Gift cards",
        href: "/gift-cards",
        icon: Gift,
        description: "Gift cards and store credit — buyers use the code online or at the POS.",
      },
    ],
  },
  {
    id: "marketing",
    label: "Marketing & AI",
    collapsible: true,
    defaultOpen: false,
    items: [
      {
        id: "workspace",
        label: "GUMA Workspace",
        href: "/workspace",
        icon: Bot,
        minPlan: "growth",
        description: "AI marketing, agents, and approved automations.",
      },
      {
        id: "ai-studio",
        label: "Marketing",
        href: "/workspace/marketing",
        icon: Sparkles,
        minPlan: "growth",
        description: "Campaigns and content generation.",
      },
      {
        id: "agents",
        label: "Posting agents",
        href: "/workspace/automations",
        icon: Bot,
        minPlan: "growth",
        description: "Scheduled posts and approval queues.",
      },
      {
        id: "tracking",
        label: "Tracking pixels",
        href: "/settings/tracking",
        icon: Link2,
        minPlan: "growth",
        description: "Facebook Pixel, GA4, and TikTok events.",
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    collapsible: true,
    items: [
      {
        id: "settings-shop",
        label: "Business",
        href: "/settings/shop",
        icon: Store,
        description: "Shop name, category, and contact details.",
      },
      {
        id: "settings-branches",
        label: "Branches",
        href: "/settings/branches",
        icon: MapPin,
        description: "Stores, stalls and warehouses — stock per branch, POS per branch.",
      },
      {
        id: "settings-partner",
        label: "Partner",
        href: "/settings/partner",
        icon: Handshake,
        description: "Let an agency or VA help run your shop.",
      },
      {
        id: "settings-pos",
        label: "POS & staff",
        href: "/settings/pos",
        icon: Users,
        description: "Cashier PINs, VAT, and shift history.",
      },
      {
        id: "developers",
        label: "API & webhooks",
        href: "/developers",
        icon: Code2,
        description: "API keys and webhooks for your own tools (owner only).",
      },
      {
        id: "help",
        label: "Help",
        href: "/help",
        icon: LifeBuoy,
        description: "Short Taglish how-tos, the status page, and support.",
      },
      {
        id: "settings-subscription",
        label: "Plan",
        href: "/settings/subscription",
        icon: Settings,
        description: "Your Guma Kart plan.",
      },
    ],
  },
];

export function findNavItemByHref(pathname: string): DashboardNavItem | undefined {
  for (const group of DASHBOARD_NAV) {
    for (const item of group.items) {
      if (item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        return item;
      }
    }
  }
  return undefined;
}
