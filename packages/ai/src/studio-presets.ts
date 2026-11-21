import { z } from "zod";

/**
 * Marketing Studio (AI Marketing Suite Phase 2) — presets and job payload contracts.
 * Shared by the seller dashboard (validates before enqueueAiMediaJob) and the GPU bridge (parses
 * the ai_media_jobs.input_payload). Client-safe: zod only.
 */

export const SCENE_PRESETS = [
  {
    id: "cozy_manila_condo",
    label: "Cozy Manila Condo",
    prompt:
      "inside a cozy modern Manila condo, light oak shelf surface, warm late-afternoon window light, soft beige and cream tones, a small potted plant in the background, shallow depth of field",
  },
  {
    id: "tropical_boracay_beach",
    label: "Tropical Boracay Beach",
    prompt:
      "on a smooth driftwood plank on a powdery white-sand Boracay beach, turquoise sea and palm shade behind, bright natural tropical sunlight, crisp vacation mood",
  },
  {
    id: "minimalist_clean_studio",
    label: "Minimalist Clean Studio",
    prompt:
      "in a minimalist photo studio, seamless off-white backdrop with a subtle gradient, soft diffused key light from the left, premium e-commerce catalog look",
  },
  {
    id: "warm_cafe_wooden_table",
    label: "Warm Cafe Wooden Table",
    prompt:
      "on a rustic wooden table in a warm specialty coffee shop, morning light through the window, soft bokeh lights, an out-of-focus coffee cup in the background",
  },
] as const;

export type ScenePresetId = (typeof SCENE_PRESETS)[number]["id"] | "custom";

export const ASPECT_RATIOS = {
  "1:1": { label: "Feed 1:1", width: 1080, height: 1080, genWidth: 1024, genHeight: 1024 },
  "9:16": { label: "Story / Reels 9:16", width: 1080, height: 1920, genWidth: 768, genHeight: 1344 },
} as const;
export type AspectRatio = keyof typeof ASPECT_RATIOS;

export const VOICE_STYLES = [
  { id: "energetic_filipina", label: "Energetic Filipina Seller", enterpriseOnly: false },
  { id: "casual_kuya", label: "Casual Taglish Kuya", enterpriseOnly: false },
  { id: "custom", label: "Custom Cloned Voice", enterpriseOnly: true },
] as const;
export type VoiceStyleId = (typeof VOICE_STYLES)[number]["id"];

export const VIDEO_DURATIONS = [15, 30] as const;

const mediaUrl = z.string().trim().min(1).max(2000);
const sceneIds = SCENE_PRESETS.map((p) => p.id) as [string, ...string[]];

export const productPhotoPayloadSchema = z
  .object({
    sourceImageUrl: mediaUrl,
    scene: z.enum([...sceneIds, "custom"] as [string, ...string[]]),
    customPrompt: z.string().trim().max(300).optional(),
    aspects: z.array(z.enum(["1:1", "9:16"])).min(1).max(2),
    productTitle: z.string().trim().max(160).optional(),
  })
  .refine((p) => p.scene !== "custom" || (p.customPrompt?.length ?? 0) >= 8, { message: "Describe the custom scene (8+ characters)", path: ["customPrompt"] });
export type ProductPhotoPayload = z.infer<typeof productPhotoPayloadSchema>;

export const videoAdPayloadSchema = z
  .object({
    imageUrls: z.array(mediaUrl).min(1).max(3),
    productTitle: z.string().trim().min(2).max(160),
    price: z.number().positive().max(10_000_000),
    promoPrice: z.number().positive().max(10_000_000).optional(),
    discountLabel: z.string().trim().max(40).optional(),
    voiceStyle: z.enum(["energetic_filipina", "casual_kuya", "custom"]),
    voiceSampleUrl: mediaUrl.optional(),
    voiceSampleText: z.string().trim().max(600).optional(),
    durationSec: z.union([z.literal(15), z.literal(30)]),
    shopName: z.string().trim().min(1).max(120),
    storeUrl: z.string().url().max(300),
    /** Only real numbers — used for honest urgency ("5 na lang"); omitted = no stock claim. */
    stockLeft: z.number().int().min(0).max(100_000).optional(),
    freeShipping: z.boolean().optional(),
    paymentMethods: z.array(z.enum(["cod", "gcash", "maya", "qrph", "card"])).max(5).default(["cod", "gcash"]),
  })
  .refine((p) => p.voiceStyle !== "custom" || (!!p.voiceSampleUrl && (p.voiceSampleText?.length ?? 0) >= 10), {
    message: "Custom voice needs your recorded sample and its exact transcript",
    path: ["voiceSampleUrl"],
  })
  .refine((p) => p.promoPrice === undefined || p.promoPrice < p.price, { message: "Promo price must be lower than the price", path: ["promoPrice"] });
export type VideoAdPayload = z.infer<typeof videoAdPayloadSchema>;

export const voiceClonePayloadSchema = z.object({
  sampleUrl: mediaUrl,
  sampleText: z.string().trim().min(10).max(600),
  previewText: z.string().trim().min(5).max(300).optional(),
});
export type VoiceClonePayload = z.infer<typeof voiceClonePayloadSchema>;

export function scenePrompt(scene: string, customPrompt?: string): string {
  if (scene === "custom") return (customPrompt ?? "").trim();
  return SCENE_PRESETS.find((p) => p.id === scene)?.prompt ?? SCENE_PRESETS[2].prompt;
}

/** "₱1,299" — Philippine peso, no decimals for whole amounts. */
export function formatPeso(amount: number): string {
  const whole = Number.isInteger(amount);
  return `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export { SCARCITY_CLAIM } from "./scarcity";

/**
 * AI suite Phase 5: branded packaging mockups for the Printair upsell (no credit, priority 10).
 * The bridge composes print-ready flats with the shop's REAL logo + QR (never regenerated, like
 * D4), then Flux.1 Fill paints a scene around each flat for the mockup photos.
 */
export const PRINTAIR_ITEMS = [
  { id: "thank_you_card", label: "Thank-you card", widthIn: 4, heightIn: 6 },
  { id: "parcel_sticker", label: "Parcel sticker", widthIn: 3, heightIn: 3 },
  { id: "mailer_box", label: "Mailer box (front panel)", widthIn: 8, heightIn: 6 },
] as const;
export type PrintairItemId = (typeof PRINTAIR_ITEMS)[number]["id"];

export const printairMockupPayloadSchema = z.object({
  shopName: z.string().trim().min(1).max(80),
  storeUrl: z.string().url().max(300),
  logoUrl: z.string().url().max(500).nullish(),
  brandColor: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/)
    .nullish(),
  tagline: z.string().trim().max(80).nullish(),
  milestone: z.string().max(20).optional(),
  items: z.array(z.enum(["thank_you_card", "parcel_sticker", "mailer_box"])).min(1).max(3).default(["thank_you_card", "parcel_sticker", "mailer_box"]),
});
export type PrintairMockupPayload = z.infer<typeof printairMockupPayloadSchema>;
