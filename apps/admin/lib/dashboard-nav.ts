import type { LucideIcon } from "lucide-react";
import {
  BadgePercent,
  Blocks,
  Code2,
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
 * Seller navigation (plan §10): Sell · Fulfill · Automate · Store, then Settings.
 * The empty placeholder pages (Users, Analytics, Integrations, Domains, Workflows,
 * Code, Logs, API, Security) are no longer listed; they come back when they ship.
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
        id: "reports",
        label: "Reports",
        href: "/reports",
        icon: BarChart3,
        badge: "new",
        description: "Sales, profit, top products and buyers, repeat rate — with CSV exports.",
      },
    ],
  },
  {
    id: "sell",
    label: "Sell",
    items: [
      {
        id: "checkout-links",
        label: "Checkout links",
        href: "/checkout-links",
        icon: Link2,
        badge: "new",
        description: "Share a one-page checkout in your posts and chats.",
      },
      {
        id: "inbox",
        label: "Chats",
        href: "/inbox",
        icon: MessageCircle,
        badge: "new",
        description: "Messenger and Instagram messages — reply and send products or checkout links.",
      },
      {
        id: "channels",
        label: "Channels",
        href: "/channels",
        icon: Share2,
        badge: "new",
        description: "Sales by channel, TikTok/Facebook/Instagram links, Messenger, Shopee and Lazada.",
      },
      {
        id: "pos",
        label: "POS",
        href: "/pos",
        icon: Calculator,
        badge: "new",
        description: "Sell in-store: cash, GCash, Maya, card; Senior/PWD; shifts.",
      },
      {
        id: "orders",
        label: "Orders",
        href: "/orders",
        icon: ShoppingBag,
        description: "Confirm payments, pack, and ship orders.",
      },
      {
        id: "products",
        label: "Products",
        href: "/products",
        icon: Package,
        description: "Your catalog, photos, prices, and stock.",
      },
      {
        id: "inventory",
        label: "Stock",
        href: "/inventory",
        icon: Boxes,
        badge: "new",
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
    label: "Fulfill",
    items: [
      {
        id: "deliveries",
        label: "Deliveries",
        href: "/orders?tab=shipping",
        icon: Truck,
        description: "Orders with a rider booked or on the way.",
      },
    ],
  },
  {
    id: "automate",
    label: "Automate",
    items: [
      {
        id: "campaigns",
        label: "SMS campaigns",
        href: "/campaigns",
        icon: Megaphone,
        badge: "new",
        description: "Text a sale to buyers who said yes — repeat buyers, VIPs, people who haven't ordered lately.",
      },
      {
        id: "discounts",
        label: "Discounts",
        href: "/discounts",
        icon: BadgePercent,
        badge: "new",
        description: "Coupon codes, quantity deals and automatic discounts.",
      },
      {
        id: "automations",
        label: "Auto SMS",
        href: "/automations",
        icon: Send,
        badge: "new",
        description: "Order updates and reminders texted to buyers for you.",
      },
      {
        id: "messages",
        label: "Messages",
        href: "/messages",
        icon: MessagesSquare,
        description: "Your AI shop assistant's chats with store visitors.",
      },
    ],
  },
  {
    id: "store",
    label: "Store",
    items: [
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
        badge: "new",
        description: "Payments, chats, Shopee/Lazada, couriers, pixels, Zapier and more — what's on and what to set up.",
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
        badge: "new",
        description: "API keys and webhooks for your own tools (owner only).",
      },
      {
        id: "help",
        label: "Help",
        href: "/help",
        icon: LifeBuoy,
        badge: "new",
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
