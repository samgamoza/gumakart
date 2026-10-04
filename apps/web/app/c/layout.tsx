import type { Viewport } from "next";
import "../kart/kart.css";

/*
  Buyer checkout for Guma Checkout Links (kart.guma.one/c/<code>). Opens inside
  Facebook / Instagram / TikTok / Messenger in-app browsers, so it stays one light
  page with the seller's name on top; Guma only appears as the small footer line.
*/
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#ffffff",
};

export default function CheckoutLinkLayout({ children }: { children: React.ReactNode }) {
  return <div className="kart min-h-dvh">{children}</div>;
}
