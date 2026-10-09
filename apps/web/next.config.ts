import type { NextConfig } from "next";
import { imageRemotePatterns } from "./lib/image-hosts";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const monorepoRoot = path.join(__dirname, "../..");

function loadRootEnv(): void {
  const envPath = path.join(monorepoRoot, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadRootEnv();


/**
 * Security G4 (GK-10). The enforced set cannot break the app: nobody may frame
 * these pages (clickjacking), no plugins, the <base> tag can't be hijacked, forms
 * only post to us (and Google sign-in). HSTS for a year. The full
 * Content-Security-Policy runs REPORT-ONLY first: Next.js needs inline scripts
 * for hydration, so 'unsafe-inline' stays until nonces are wired; watch the
 * browser console for a week, then move it to Content-Security-Policy.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self' https://accounts.google.com" },
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net https://analytics.tiktok.com https://maps.googleapis.com https://accounts.google.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.google-analytics.com https://www.facebook.com https://analytics.tiktok.com https://maps.googleapis.com https://api.paymongo.com https://accounts.google.com",
      "frame-src https://accounts.google.com https://checkout.paymongo.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: [
    "@gumakart/ui",
    "@gumakart/ai",
    "@gumakart/services",
    "@gumakart/db",
    "@gumakart/storefront-themes",
  ],
  outputFileTracingRoot: monorepoRoot,
  images: {
    // Phase 20: few widths + WebP only — each photo × width is one Cloudflare transformation.
    // Same numbers as lib/image-sizes.ts.
    deviceSizes: [384, 640, 828, 1200],
    imageSizes: [64, 128, 256],
    formats: ["image/webp"],
    // Security G1 (GK-11): only the hosts photos live on are optimised; see lib/image-hosts.ts.
    // Other remote images are passed through untouched by the custom loader.
    loader: "custom",
    loaderFile: "./lib/image-loader.ts",
    remotePatterns: imageRemotePatterns(),
    localPatterns: [
      { pathname: "/uploads/**" },
      { pathname: "/**" },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Order and account pages carry tokens in the URL: never let a tracking pixel or a link see them.
      { source: "/:tenantSlug/orders/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/account/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
