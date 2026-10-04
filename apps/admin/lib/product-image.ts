const STOREFRONT_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3010";

/** Same rules as the Products page: absolute URLs as-is, local uploads via the admin proxy. */
export function productImageSrc(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("/uploads/products/")) {
    return `/api/products/media?path=${encodeURIComponent(url)}`;
  }
  return `${STOREFRONT_URL}${url}`;
}
