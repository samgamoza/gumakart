/**
 * Settings menu (plan §10): Business · Payments · Delivery · Notifications · Plan first.
 * Wallet / payouts and KYC are hidden in V1 (payouts are simulated, plan §3.1);
 * their pages still exist for ops.
 */
export const SETTINGS_SECTIONS = [
  { href: "/settings/shop", label: "Business", icon: "🏪", description: "Name, category, contact, and locale" },
  { href: "/settings/payments", label: "Payments", icon: "💸", description: "GCash / Maya numbers and cash on delivery" },
  { href: "/settings/delivery-shipping", label: "Delivery", icon: "🚚", description: "Pickup, fees, and couriers" },
  { href: "/settings/notifications", label: "Notifications", icon: "🔔", description: "Email and SMS alerts" },
  { href: "/settings/subscription", label: "Plan", icon: "💳", description: "Your Guma Kart plan" },
  { href: "/settings/account", label: "Password & security", icon: "🔐", description: "Login, password, and account access" },
  { href: "/settings/whatsapp-agent", label: "WhatsApp Agent", icon: "💬", description: "Auto-replies and order chat" },
  { href: "/settings/tracking", label: "Tracking", icon: "📊", description: "Pixels and analytics IDs" },
  { href: "/settings/support", label: "Help & support", icon: "🆘", description: "Contact Guma support" },
] as const;

export type SettingsSectionHref = (typeof SETTINGS_SECTIONS)[number]["href"];

export function getSettingsSectionTitle(pathname: string): string | null {
  const section = SETTINGS_SECTIONS.find((item) => item.href === pathname);
  return section?.label ?? null;
}
