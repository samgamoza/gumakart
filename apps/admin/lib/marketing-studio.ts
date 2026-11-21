import { NextResponse } from "next/server";
import { getAiSuiteTier, type MediaJobDenial } from "@gumakart/plans";
import { assertTenantOwnsMedia } from "@/lib/product-uploads";

/** Storefront base, e.g. https://kart.guma.one (store links, QR end cards). */
export function storefrontBase(): string {
  return (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3010").replace(/\/$/, "");
}

export function storeUrlFor(slug: string): string {
  return `${storefrontBase()}/${slug}`;
}

export class StudioInputError extends Error {}

/** Every media URL in a request must be this shop's (see assertTenantOwnsMedia). */
export function assertMediaOwned(tenantId: string, urls: Array<string | undefined>): void {
  for (const u of urls) {
    if (!u) continue;
    try {
      assertTenantOwnsMedia(tenantId, u);
    } catch {
      throw new StudioInputError("Use photos and recordings uploaded to your shop.");
    }
  }
}

const DENIAL_MESSAGE: Record<MediaJobDenial | "out_of_credits" | "no_entitlements" | "voice_clone_not_included_video", string> = {
  photo_not_included: "AI product photos start on the Starter plan.",
  video_not_included: "AI video ads are on Pro Live and Enterprise Vibe.",
  voice_clone_not_included: "Custom cloned voices are on Enterprise Vibe.",
  voice_clone_not_included_video: "Custom cloned voices are on Enterprise Vibe — pick a preset voice instead.",
  out_of_credits: "You've used this month's credits. They reset on the 1st.",
  no_entitlements: "Your plan details are still loading — try again in a minute.",
};

export function denialResponse(reason: keyof typeof DENIAL_MESSAGE): NextResponse {
  return NextResponse.json({ ok: false, code: reason, error: DENIAL_MESSAGE[reason], upgradeRequired: reason !== "out_of_credits" && reason !== "no_entitlements" }, { status: 402 });
}

/** Comment-to-DM triggers: Starter and up (Free shops can still save the post). */
export function canAttachTrigger(subscriptionPlan: string | null | undefined): boolean {
  return getAiSuiteTier(subscriptionPlan).legacyFeaturePlan !== "free";
}
