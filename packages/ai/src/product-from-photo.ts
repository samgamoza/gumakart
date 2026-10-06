/**
 * Phase 33 (H2, palenkeAi "analyze-catalog-product"): a product photo → a draft listing the seller reviews.
 * The AI names and describes what it sees. It never sets a price or stock, and never claims a brand or
 * material it can't see ("parang leather" is fine; "genuine leather" isn't). Nothing is saved until the
 * seller presses Save.
 */
import { z } from "zod";
import { callVision, resolveVisionModel, type VisionCallInput } from "./providers/llm";

export interface PhotoListingInput {
  imageBase64: string;
  mimeType: VisionCallInput["mimeType"];
  shopName: string;
  shopCategory?: string | null;
  /** Optional words from the seller ("size 8, pre-loved"). */
  hint?: string;
}

const outputSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(2),
  tags: z.array(z.string()).default([]),
  /** Short phrase like "bag", "dress", "snack". */
  productType: z.string().optional().default(""),
  /** What the seller should check because the photo can't show it. */
  checks: z.array(z.string()).default([]),
});

export type PhotoListing = z.infer<typeof outputSchema>;

const BANNED = /\b(?:genuine|authentic|original|guaranteed|best in the philippines|fda[- ]approved)\b|\b100\s?%/gi;

export function buildPhotoListingPrompt(input: PhotoListingInput): { system: string; user: string } {
  const system = [
    "You write product listings for a small Filipino online shop from one photo.",
    "Write in natural Taglish (mostly English, a little Tagalog), friendly and clear.",
    "Describe only what is visible: item type, colour, pattern, style, visible features.",
    "Never state a price, stock, brand, size, material or certification unless it is clearly printed in the photo.",
    "Never use the words genuine, authentic, original, guaranteed or 100%.",
    'Return JSON: {"title": string (max 70 chars, no emojis), "description": string (2-4 short sentences, max 500 chars),',
    '"tags": string[] (3-8 lowercase search words), "productType": string (1-2 words),',
    '"checks": string[] (1-3 things the seller must fill in, e.g. "Size", "Material")}.',
  ].join("\n");
  const user = [
    `Shop: ${input.shopName}${input.shopCategory ? ` (sells ${input.shopCategory})` : ""}.`,
    input.hint ? `Seller's note about this item: ${input.hint.slice(0, 200)}` : "No note from the seller.",
    "Write the listing for the item in the photo.",
  ].join("\n");
  return { system, user };
}

/** Validate and clean the model's JSON; throws if unusable. */
export function parsePhotoListing(raw: string): PhotoListing {
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("The AI reply wasn't readable.");
  }
  const o = outputSchema.parse(data);
  const clean = (s: string) => s.replace(BANNED, "").replace(/\s{2,}/g, " ").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").trim();
  const title = clean(o.title).slice(0, 80);
  const description = clean(o.description).slice(0, 600);
  if (title.length < 2 || description.length < 2) throw new Error("The AI reply was empty.");
  const tags = [...new Set(o.tags.map((t) => t.toLowerCase().replace(/[^a-z0-9ñ -]/g, "").trim()).filter((t) => t.length > 1))].slice(0, 8);
  return {
    title,
    description,
    tags,
    productType: clean(o.productType ?? "").slice(0, 30),
    checks: o.checks.map(clean).filter(Boolean).slice(0, 3),
  };
}

export function mockPhotoListing(input: PhotoListingInput): PhotoListing {
  return {
    title: input.hint ? `Item — ${input.hint.slice(0, 40)}` : "New item from photo",
    description: "Ganda nito for everyday use. Check the photo for the colour and details.",
    tags: ["new", "item"],
    productType: "item",
    checks: ["Size", "Material"],
  };
}

export async function runPhotoListing(input: PhotoListingInput): Promise<{ output: PhotoListing; tokensUsed: number; model: string }> {
  const model = resolveVisionModel();
  if (model === "mock") return { output: mockPhotoListing(input), tokensUsed: 0, model: "mock" };
  const prompt = buildPhotoListingPrompt(input);
  const result = await callVision(model, { ...prompt, imageBase64: input.imageBase64, mimeType: input.mimeType });
  return { output: parsePhotoListing(result.content), tokensUsed: result.tokensUsed ?? 0, model: result.model };
}
