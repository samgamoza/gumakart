import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  Code2,
  Database,
  FileText,
  Globe,
  LayoutDashboard,
  Link2,
  Package,
  Plug,
  ScrollText,
  Settings,
  Shield,
  ShoppingBag,
  Sparkles,
  Store,
  Users,
  Workflow,
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

/** Base44-inspired tenant dashboard navigation with plan gates. */
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
        description: "Sales, orders, and setup progress at a glance.",
      },
    ],
  },
  {
    id: "commerce",
    label: "Commerce",
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
        id: "products",
        label: "Products",
        href: "/products",
        icon: Package,
        description: "Manage your catalog, photos, and inventory.",
      },
      {
        id: "categories",
        label: "Categories",
        href: "/categories",
        icon: Database,
        description: "Organize products into browsable groups.",
      },
      {
        id: "orders",
        label: "Orders",
        href: "/orders",
        icon: ShoppingBag,
        description: "Accept, fulfill, and track customer orders.",
      },
      {
        id: "messages",
        label: "Messages",
        href: "/messages",
        icon: Bot,
        description: "Buyer storefront chat for payment and product help.",
      },
      {
        id: "launch",
        label: "Storefront look",
        href: "/launch",
        icon: Sparkles,
        badge: "new",
        description: "Change template, colors, and publish your shop look.",
      },
    ],
  },
  {
    id: "customers",
    label: "Customers & data",
    items: [
      {
        id: "users",
        label: "Users",
        href: "/dashboard/users",
        icon: Users,
        minPlan: "growth",
        description: "Customer profiles, repeat buyers, and segments.",
      },
      {
        id: "analytics",
        label: "Analytics",
        href: "/dashboard/analytics",
        icon: BarChart3,
        minPlan: "growth",
        description: "Traffic, conversion, and revenue trends.",
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
        label: "Automations",
        href: "/workspace/automations",
        icon: Bot,
        minPlan: "growth",
        description: "Posting agents and approval queues.",
      },
      {
        id: "integrations",
        label: "Integrations",
        href: "/dashboard/integrations",
        icon: Plug,
        minPlan: "growth",
        description: "Connect Meta, Google, couriers, and more.",
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
    id: "platform",
    label: "Platform",
    collapsible: true,
    items: [
      {
        id: "domains",
        label: "Domains",
        href: "/dashboard/domains",
        icon: Globe,
        minPlan: "pro",
        description: "Custom domain and SSL for your shop.",
      },
      {
        id: "workflows",
        label: "Workflows",
        href: "/dashboard/workflows",
        icon: Workflow,
        minPlan: "pro",
        description: "Automate order, payout, and marketing flows.",
      },
      {
        id: "code",
        label: "Code",
        href: "/dashboard/code",
        icon: Code2,
        minPlan: "pro",
        description: "Custom CSS, embeds, and head scripts.",
      },
      {
        id: "logs",
        label: "Logs",
        href: "/dashboard/logs",
        icon: ScrollText,
        minPlan: "pro",
        description: "Webhook, payment, and agent activity logs.",
      },
      {
        id: "api",
        label: "API",
        href: "/dashboard/api",
        icon: FileText,
        minPlan: "pro",
        description: "REST keys and webhooks for your stack.",
      },
      {
        id: "security",
        label: "Security",
        href: "/dashboard/security",
        icon: Shield,
        minPlan: "growth",
        description: "Staff access, 2FA, and audit trail.",
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
        label: "App settings",
        href: "/settings/shop",
        icon: Store,
        description: "Shop identity, promo banner, and locale.",
      },
      {
        id: "settings-subscription",
        label: "Subscription",
        href: "/settings/subscription",
        icon: Settings,
        description: "Plans, billing, and upgrades.",
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
