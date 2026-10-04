import { z } from "zod";

const PH_MOBILE = /^(09\d{9}|\+?639\d{9})$/;

/** Onboarding step 1 extras (plan §9): seller mobile + where they sell now. */
export const businessProfileFields = {
  mobile: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(PH_MOBILE, "Enter your mobile number, e.g. 0917 123 4567.")),
  sellChannels: z
    .array(z.enum(["facebook", "instagram", "tiktok", "messenger", "shopee", "lazada", "other"]))
    .max(7)
    .optional(),
  chatUrl: z.string().trim().max(300).optional(),
};
