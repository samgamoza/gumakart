/**
 * "Back to chat" (plan §5, 3C): after ordering, send the buyer back to where they
 * were talking to the seller. Uses the shop's saved page/chat link; falls back to
 * the shop's WhatsApp number. Only http(s) links are ever returned.
 */
export interface BackToChat {
  href: string;
  label: string;
  app: "messenger" | "facebook" | "instagram" | "whatsapp" | "tiktok" | "viber" | "telegram" | "other";
}

const APP_LABEL: Record<BackToChat["app"], string> = {
  messenger: "Bumalik sa Messenger",
  facebook: "Bumalik sa Facebook page",
  instagram: "Bumalik sa Instagram",
  whatsapp: "Bumalik sa WhatsApp",
  tiktok: "Bumalik sa TikTok",
  viber: "Bumalik sa Viber",
  telegram: "Bumalik sa Telegram",
  other: "Bumalik sa chat ng shop",
};

export function appForChatHost(hostname: string): BackToChat["app"] {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (host === "m.me" || host.endsWith("messenger.com")) return "messenger";
  if (host === "fb.com" || host === "fb.me" || host.endsWith("facebook.com")) return "facebook";
  if (host === "ig.me" || host.endsWith("instagram.com")) return "instagram";
  if (host === "wa.me" || host.endsWith("whatsapp.com")) return "whatsapp";
  if (host.endsWith("tiktok.com")) return "tiktok";
  if (host.endsWith("viber.com") || host === "vb.me") return "viber";
  if (host === "t.me" || host.endsWith("telegram.me")) return "telegram";
  return "other";
}

export function resolveBackToChat(input: {
  chatUrl?: string | null;
  whatsappPhone?: string | null;
  whatsappEnabled?: boolean;
  orderNumber?: string;
}): BackToChat | null {
  const raw = input.chatUrl?.trim();
  if (raw) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (url.protocol === "https:" || url.protocol === "http:") {
        const app = appForChatHost(url.hostname);
        return { href: url.toString(), label: APP_LABEL[app], app };
      }
    } catch {
      // fall through to WhatsApp
    }
  }
  const digits = (input.whatsappPhone ?? "").replace(/\D/g, "");
  if (input.whatsappEnabled && digits.length >= 10) {
    const intl = digits.startsWith("0") ? `63${digits.slice(1)}` : digits;
    const url = new URL(`https://wa.me/${intl}`);
    if (input.orderNumber) url.searchParams.set("text", `Hi! About my order #${input.orderNumber}`);
    return { href: url.toString(), label: APP_LABEL.whatsapp, app: "whatsapp" };
  }
  return null;
}
