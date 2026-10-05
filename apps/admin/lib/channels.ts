import { NextResponse } from "next/server";
import { InboxError, withChannelRef, type SalesChannel } from "@gumakart/db";
import { ApiAuthError } from "@/lib/api-auth";
import { storefrontBaseUrl } from "@/lib/utils";

/** Phase 13 helpers shared by the inbox and channel routes. */

const base = () => storefrontBaseUrl.replace(/\/$/, "");

/** Public product page, tagged with the channel (and the chat it was sent in). */
export function productShareUrl(shopSlug: string, productSlug: string, channel: SalesChannel, threadId?: string | null): string {
  const url = withChannelRef(`${base()}/${shopSlug}/products/${encodeURIComponent(productSlug)}`, channel);
  return threadId ? `${url}&th=${threadId}` : url;
}

export function checkoutLinkShareUrl(code: string, channel: SalesChannel, threadId?: string | null): string {
  const url = withChannelRef(`${base()}/c/${encodeURIComponent(code)}`, channel);
  return threadId ? `${url}&th=${threadId}` : url;
}

export function shopShareUrl(shopSlug: string, channel: SalesChannel): string {
  return withChannelRef(`${base()}/${shopSlug}`, channel);
}

/** Meta fetches card images itself: they must be public absolute URLs. */
export function publicImageUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^https:\/\//i.test(url)) return url;
  if (url.startsWith("/") && /^https:\/\//i.test(base())) return `${base()}${url}`;
  return null;
}

export function channelFail(error: unknown, label: string): NextResponse {
  if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  if (error instanceof InboxError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "TAKEN" ? 409 : 400;
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status });
  }
  if (error && typeof error === "object" && (error as { name?: string }).name === "ZodError") {
    const issues = (error as { errors?: Array<{ message: string }> }).errors;
    return NextResponse.json({ ok: false, error: issues?.[0]?.message ?? "Check the details." }, { status: 400 });
  }
  if (error && typeof error === "object" && (error as { name?: string }).name === "MarketplaceError") {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 });
  }
  console.error(`[channels] ${label}`, error);
  return NextResponse.json({ ok: false, error: "Something went wrong. Try again." }, { status: 500 });
}
