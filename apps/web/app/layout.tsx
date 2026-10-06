import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { THEME_FONT_VARIABLES } from "@/components/storefront/theme-fonts";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Guma One — Turn Social Posts Into Sales",
  description:
    "The all-in-one social commerce platform for Philippine sellers. AI content, GCash checkout, Lalamove delivery — no more Messenger chaos.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Guma One" },
  openGraph: {
    title: "Guma One — Social Commerce for PH Sellers",
    description: "Post on FB, TikTok, IG. Customers order in seconds.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#059669",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${bricolage.variable} ${THEME_FONT_VARIABLES}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
