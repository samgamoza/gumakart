import type { NextConfig } from "next";
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

const nextConfig: NextConfig = {
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
    remotePatterns: [{ protocol: "https", hostname: "**" }],
    localPatterns: [
      { pathname: "/uploads/**" },
      { pathname: "/**" },
    ],
  },
};

export default nextConfig;
