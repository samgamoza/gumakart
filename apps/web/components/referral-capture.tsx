"use client";

import { useEffect } from "react";
import { captureReferral } from "@/lib/referral-capture";

/** Phase 32: stores ?ref=suki&code=CODE for this shop (renders nothing). */
export function ReferralCapture({ slug }: { slug: string }) {
  useEffect(() => captureReferral(slug), [slug]);
  return null;
}
