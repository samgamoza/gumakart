import { z } from "zod";
import { bridgeConfigFromEnv, runLocalFirst, type GpuBridgeConfig } from "./gpu-bridge-client";
import { normalizePlan, resolveBudgetAwareModel } from "./plan-limits";
import { callLlm, resolveEffectiveModel } from "./providers/llm";
import { formatPeso } from "./studio-presets";
import { SCARCITY_CLAIM } from "./scarcity";

/**
 * Taglish viral copy & hook generator (AI Marketing Suite Phase 2.3).
 * Qwen3 on the home GPU node via the bridge, cloud model as fallback (D1). Honest claims only (D5):
 * stock numbers and free shipping are mentioned only when the seller's data says so.
 */
export const COPY_PLATFORMS = ["facebook", "instagram", "tiktok"] as const;
export const COPY_ANGLES = ["auto", "urgency", "payday", "bundle", "new_arrival", "restock"] as const;
export const PAYMENT_METHODS = ["cod", "gcash", "maya", "qrph", "card"] as const;

export const copywriterInputSchema = z.object({
  shopName: z.string().trim().min(1).max(120),
  productTitle: z.string().trim().min(2).max(160),
  price: z.number().positive().nullable(),
  promoPrice: z.number().positive().nullable().optional(),
  details: z.string().trim().max(800).optional(),
  link: z.string().url().max(400),
  platform: z.enum(COPY_PLATFORMS),
  angle: z.enum(COPY_ANGLES).default("auto"),
  stockLeft: z.number().int().min(0).nullable().optional(),
  freeShipping: z.boolean().default(false),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1).max(5).default(["cod", "gcash"]),
  language: z.enum(["taglish", "tagalog", "english"]).default("taglish"),
});
export type CopywriterInput = z.input<typeof copywriterInputSchema>;
type CopywriterParsed = z.output<typeof copywriterInputSchema>;

export interface CopywriterOutput {
  hooks: string[];
  caption: string;
  cta: string;
  hashtags: string[];
  /** What buyers should comment to get the DM (feeds the comment-to-DM trigger). */
  commentKeyword: string;
  /** Short public replies the auto-responder rotates through. */
  publicReplies: string[];
  trustBadges: string[];
}

const PAY_LABEL: Record<string, string> = { cod: "COD", gcash: "GCash", maya: "Maya", qrph: "QRPh", card: "Card" };
const PLATFORM_RULES: Record<CopywriterParsed["platform"], string> = {
  facebook: "Facebook post: 3–6 short lines, emojis allowed but not every line, link on its own line.",
  instagram: "Instagram caption: punchy first line, line breaks, hashtags at the end, say 'link in bio / comment KEYWORD' — still include the link line.",
  tiktok: "TikTok caption: max ~150 characters before hashtags, very punchy, Gen-Z friendly Taglish.",
};
const ANGLE_HINT: Record<CopywriterParsed["angle"], string> = {
  auto: "Pick the strongest angle for this product.",
  urgency: "Angle: urgency — but only real urgency (stock number if given, otherwise 'habang may stock pa').",
  payday: "Angle: payday treat (sweldo / kinsenas-katapusan), 'deserve mo 'to'.",
  bundle: "Angle: buy more save more / barkada bundle.",
  new_arrival: "Angle: new arrival, first to have it.",
  restock: "Angle: back in stock, 'restocked na!'.",
};

export function buildCopywriterMessages(input: CopywriterParsed): { system: string; user: string } {
  const facts: string[] = [`Shop: ${input.shopName}`, `Product: ${input.productTitle}`];
  if (input.price !== null) {
    facts.push(input.promoPrice ? `Price: ${formatPeso(input.promoPrice)} (regular ${formatPeso(input.price)})` : `Price: ${formatPeso(input.price)}`);
  }
  if (input.details) facts.push(`Details: ${input.details}`);
  if (input.stockLeft !== null && input.stockLeft !== undefined && input.stockLeft > 0 && input.stockLeft <= 50) facts.push(`Stock left: ${input.stockLeft} (you may say this exact number)`);
  if (input.freeShipping) facts.push("Free shipping via BayanGo: YES");
  facts.push(`Payment: ${input.paymentMethods.map((m) => PAY_LABEL[m]).join(", ")}`);
  facts.push(`Order link: ${input.link}`);

  const system = [
    "You are a top Filipino social-commerce copywriter for small online sellers (FB, IG, TikTok).",
    input.language === "taglish"
      ? "Write in natural Taglish — how real Pinoy sellers and buyers talk. Warm, kwela, confident. Use 'po' sometimes."
      : input.language === "tagalog"
        ? "Write in conversational Tagalog."
        : "Write in simple, friendly English for Filipino buyers.",
    "Know PH buyer psychology: scroll-stopping first line, price clarity with ₱, trust (COD/GCash/Maya), 'Mine'/'HM' comment culture, payday buying, barkada sharing.",
    PLATFORM_RULES[input.platform],
    ANGLE_HINT[input.angle],
    "HARD RULES:",
    "- Only use facts from FACTS. Never invent stock counts, sold counts, ratings, reviews, deadlines, discounts or free shipping.",
    "- Without a stock number, urgency stays general ('habang may stock pa', 'limited lang').",
    "- Prices exactly as given. Mention only the listed payment methods.",
    "- No health/medical or guaranteed-results claims. No fake scarcity.",
    "- Hashtags: 6–10, mix of product tags and PH tags like #TikTokFindsPH #BudolFinds #SupportLocalPH #OnlineShopPH.",
    "Reply with JSON only:",
    '{"hooks":["3 different scroll-stopping first lines"],"caption":"full post text including the order link","cta":"one-line call to action",' +
      '"hashtags":["#…"],"commentKeyword":"ONE WORD buyers comment to get a DM, e.g. MINE","publicReplies":["3 short public replies to commenters, e.g. Sent you a DM po!"],' +
      '"trustBadges":["e.g. COD available","GCash"]}',
  ].join("\n");
  return { system, user: `FACTS:\n${facts.join("\n")}\n\nWrite the ${input.platform} copy.` };
}

const outputSchema = z.object({
  hooks: z.array(z.string()).min(1),
  caption: z.string().min(10),
  cta: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  commentKeyword: z.string().optional(),
  publicReplies: z.array(z.string()).optional(),
  trustBadges: z.array(z.string()).optional(),
});

export function normalizeHashtags(tags: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of tags ?? []) {
    for (const piece of raw.split(/[\s,#]+/)) {
      const t = piece.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
      if (t.length >= 2 && !out.some((o) => o.toLowerCase() === `#${t}`.toLowerCase())) out.push(`#${t}`);
    }
  }
  if (!out.some((t) => /SupportLocalPH/i.test(t))) out.push("#SupportLocalPH");
  return out.slice(0, 12);
}

/** Remove claims the model made up (D5). */
export function scrubCopyClaims(text: string, input: CopywriterParsed): string {
  const stock = input.stockLeft !== null && input.stockLeft !== undefined && input.stockLeft > 0 && input.stockLeft <= 50 ? input.stockLeft : null;
  let out = text.replace(SCARCITY_CLAIM, (m: string, n1?: string, n2?: string) => (stock !== null && Number(n1 ?? n2) === stock ? m : "habang may stock pa"));
  out = out.replace(/\b\d{2,6}\+?\s*(sold|nabenta|orders?)\b/gi, "");
  if (!input.freeShipping) out = out.replace(/(free|libreng?)\s+(shipping|delivery|sf)\b/gi, "mabilis na delivery");
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

export function parseCopywriterOutput(raw: string, input: CopywriterParsed): CopywriterOutput | null {
  const text = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let json: unknown;
  try {
    json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const r = outputSchema.safeParse(json);
  if (!r.success) return null;
  const o = r.data;
  let caption = scrubCopyClaims(o.caption, input);
  if (!caption.includes(input.link)) caption = `${caption}\n\n🛒 ${input.link}`;
  const keyword = (o.commentKeyword ?? "MINE").replace(/[^\p{L}\p{N}?]/gu, "").toUpperCase().slice(0, 16) || "MINE";
  const replies = (o.publicReplies ?? []).map((s) => scrubCopyClaims(s, input).slice(0, 200)).filter((s) => s.length > 2).slice(0, 3);
  return {
    hooks: o.hooks.map((h) => scrubCopyClaims(h, input).slice(0, 200)).filter(Boolean).slice(0, 3),
    caption: caption.slice(0, 2200),
    cta: scrubCopyClaims(o.cta ?? `Comment "${keyword}" o order na sa link!`, input).slice(0, 200),
    hashtags: normalizeHashtags(o.hashtags),
    commentKeyword: keyword,
    publicReplies: replies.length ? replies : DEFAULT_PUBLIC_REPLIES,
    trustBadges: (o.trustBadges ?? []).map((b) => b.slice(0, 40)).filter(Boolean).slice(0, 5),
  };
}

export const DEFAULT_PUBLIC_REPLIES = ["Sent you a DM po! Check your message requests 💌", "Hi! Nag-PM na kami sa inyo po 😊", "Check your inbox po — sent the details!"];

export function mockCopywriter(input: CopywriterParsed): CopywriterOutput {
  const price = input.price === null ? "" : input.promoPrice ? `${formatPeso(input.promoPrice)} na lang (dati ${formatPeso(input.price)})` : `${formatPeso(input.price)} lang`;
  const pay = input.paymentMethods.map((m) => PAY_LABEL[m]).join(" / ");
  return {
    hooks: [`Uy! Ito na ang ${input.productTitle} na hinahanap mo 👀`, `Sulit na ${input.productTitle}${price ? ` — ${price}` : ""}!`, `Pang-araw-araw na upgrade: ${input.productTitle} ✨`],
    caption: `Uy! Ito na ang ${input.productTitle} na hinahanap mo 👀\n${price ? `${price}! ` : ""}${input.freeShipping ? "Free shipping via BayanGo! " : ""}Habang may stock pa!\n${pay} available ✅\n\nComment "MINE" o order na:\n🛒 ${input.link}`,
    cta: `Comment "MINE" o order na sa link!`,
    hashtags: normalizeHashtags(["#TikTokFindsPH", "#BudolFinds", "#OnlineShopPH", "#SupportLocalPH"]),
    commentKeyword: "MINE",
    publicReplies: DEFAULT_PUBLIC_REPLIES,
    trustBadges: input.paymentMethods.map((m) => (m === "cod" ? "COD available" : PAY_LABEL[m]!)),
  };
}

export interface CopywriterRunResult {
  output: CopywriterOutput;
  tokensUsed: number;
  model: string;
  servedBy: "gpu-node" | "cloud" | "mock";
}

export async function runTaglishCopywriter(
  rawInput: CopywriterInput,
  opts: { tenantId: string; plan?: string | null; tokensUsedThisMonth?: number; bridge?: GpuBridgeConfig | null; onFallback?: (reason: string, error?: unknown) => void }
): Promise<CopywriterRunResult> {
  const input = copywriterInputSchema.parse(rawInput);
  const prompt = buildCopywriterMessages(input);
  const bridge = opts.bridge === undefined ? bridgeConfigFromEnv() : opts.bridge;

  const run = await runLocalFirst<CopywriterRunResult>({
    bridge,
    request: {
      tenantId: opts.tenantId,
      purpose: "copywriter",
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      maxTokens: 900,
      temperature: 0.9,
      responseFormat: { type: "json_object" },
    },
    fromBridge: (r) => {
      const output = parseCopywriterOutput(r.content, input);
      return output ? { output, tokensUsed: r.usage.promptTokens + r.usage.completionTokens, model: r.model, servedBy: "gpu-node" } : null;
    },
    cloud: async () => {
      const requested = resolveBudgetAwareModel(normalizePlan(opts.plan ?? "free"), "generation", opts.tokensUsedThisMonth);
      const model = resolveEffectiveModel(requested);
      if (model === "mock") return { output: mockCopywriter(input), tokensUsed: 0, model: "mock", servedBy: "mock" };
      const res = await callLlm({ model, system: prompt.system, user: prompt.user, jsonMode: true, maxTokens: 900 });
      return { output: parseCopywriterOutput(res.content, input) ?? mockCopywriter(input), tokensUsed: res.tokensUsed ?? 0, model: res.model, servedBy: "cloud" };
    },
    onFallback: opts.onFallback,
  });
  return run.result;
}
