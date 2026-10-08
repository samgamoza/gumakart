/**
 * Security G1 (GK-11): which remote hosts the storefront's image optimiser will fetch.
 *
 * `/_next/image` runs a Cloudflare transformation for every photo × width it is asked
 * for. With `hostname: "**"` anyone could point it at any website and burn the shop's
 * free quota (then real photos break). Only the hosts photos actually live on are
 * optimised; any other remote image is shown as-is (`unoptimized`) — never fetched by
 * our server.
 *
 * Add hosts with NEXT_PUBLIC_IMAGE_HOSTS="cdn.example.com,images.example.org" (build time).
 */
const BUILT_IN_HOSTS = [
  // Vercel Blob (product photos when BLOB_READ_WRITE_TOKEN is set).
  "*.public.blob.vercel-storage.com",
  // Theme demo imagery.
  "images.unsplash.com",
];

export function allowedImageHosts(): string[] {
  const extra = (process.env.NEXT_PUBLIC_IMAGE_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...BUILT_IN_HOSTS, ...extra];
}

function hostMatches(host: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".public.blob.vercel-storage.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === pattern;
}

/** True for same-origin paths and for remote URLs on an allow-listed https host. */
export function isOptimizableImageSrc(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  if (src.startsWith("data:") || src.startsWith("blob:")) return false;
  try {
    const url = new URL(src);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return allowedImageHosts().some((p) => hostMatches(host, p));
  } catch {
    return false;
  }
}

/** `remotePatterns` for next.config, derived from the same list. */
export function imageRemotePatterns(): Array<{ protocol: "https"; hostname: string }> {
  return allowedImageHosts().map((hostname) => ({ protocol: "https" as const, hostname }));
}
