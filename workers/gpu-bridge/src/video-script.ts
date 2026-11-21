import { z } from "zod";
import { formatPeso, SCARCITY_CLAIM, type VideoAdPayload } from "@gumakart/ai/studio";
import type { ChatMessage } from "./llm-client";

/**
 * Qwen3 writes a 3-scene Taglish hook → body → CTA ad script with timestamps.
 * Claims are limited to facts the seller gave us (decision D5).
 */
export interface VideoScene {
  role: "hook" | "body" | "cta";
  start: number;
  end: number;
  /** Spoken Taglish line (voiceover + subtitles). */
  line: string;
  /** English camera/motion hint for Wan 2.1. */
  visual: string;
}

export interface VideoScript {
  scenes: [VideoScene, VideoScene, VideoScene];
  source: "llm" | "template";
}

const PAYMENT_LABEL: Record<string, string> = { cod: "COD", gcash: "GCash", maya: "Maya", qrph: "QRPh", card: "card" };

export function facts(p: VideoAdPayload): string[] {
  const out = [`Product: ${p.productTitle}`, `Shop: ${p.shopName}`];
  if (p.promoPrice !== undefined) out.push(`Price: ${formatPeso(p.promoPrice)} (regular ${formatPeso(p.price)})`);
  else out.push(`Price: ${formatPeso(p.price)}`);
  if (p.discountLabel) out.push(`Promo: ${p.discountLabel}`);
  if (p.stockLeft !== undefined && p.stockLeft > 0 && p.stockLeft <= 50) out.push(`Stock left: ${p.stockLeft} pieces (you may say this exact number)`);
  if (p.freeShipping) out.push("Free shipping via BayanGo: YES");
  out.push(`Payment: ${p.paymentMethods.map((m) => PAYMENT_LABEL[m] ?? m).join(", ")}`);
  out.push(`Order link: ${p.storeUrl.replace(/^https?:\/\//, "")}`);
  return out;
}

export function buildScriptMessages(p: VideoAdPayload): ChatMessage[] {
  const words = p.durationSec === 15 ? "32–40" : "65–78";
  return [
    {
      role: "system",
      content: [
        "You write short vertical video ad scripts for Filipino social sellers (TikTok, Reels, FB).",
        "Language: natural Taglish, warm and energetic, the way a real Pinoy seller talks on live. Use 'po' naturally.",
        "Structure: exactly 3 scenes — hook (stop the scroll in the first 2 seconds), body (benefit + price), cta (tell them how to order).",
        "RULES — never break these:",
        "- Only state facts from FACTS. Never invent stock counts, sold counts, ratings, discounts, deadlines or free shipping.",
        "- If FACTS has no stock number, urgency must stay general (e.g. 'habang may stock pa').",
        "- Say prices exactly as given, with ₱.",
        "- Mention only the payment methods listed.",
        `- Total spoken words across the 3 lines: ${words}.`,
        "- 'visual' is a short English camera/motion direction for an image-to-video model (e.g. 'slow push-in, soft sunlight sweep across the product').",
        'Reply with JSON only: {"scenes":[{"role":"hook","start":0,"end":4,"line":"…","visual":"…"},{"role":"body",…},{"role":"cta",…}]}',
        `Timestamps are seconds; scene 1 starts at 0, scene 3 ends at ${p.durationSec}.`,
      ].join("\n"),
    },
    { role: "user", content: `FACTS:\n${facts(p).join("\n")}\n\nDuration: ${p.durationSec}s. Write the script.` },
  ];
}

const sceneSchema = z.object({
  role: z.enum(["hook", "body", "cta"]).optional(),
  start: z.coerce.number(),
  end: z.coerce.number(),
  line: z.string().trim().min(3).max(400),
  visual: z.string().trim().max(300).optional(),
});
const scriptSchema = z.object({ scenes: z.array(sceneSchema).length(3) });

const DEFAULT_SPLIT: Record<15 | 30, [number, number]> = { 15: [4, 10], 30: [6, 20] };

/** Monotonic scene boundaries from 0 to D, each ≥ 2.5 s; otherwise the default split. */
export function normalizeTiming(scenes: Array<{ start: number; end: number }>, D: 15 | 30): Array<[number, number]> {
  const b1 = scenes[0]!.end;
  const b2 = scenes[1]!.end;
  const ok = b1 >= 2.5 && b2 - b1 >= 2.5 && D - b2 >= 2.5 && Number.isFinite(b1) && Number.isFinite(b2);
  const [x, y] = ok ? [b1, b2] : DEFAULT_SPLIT[D];
  return [
    [0, x],
    [x, y],
    [y, D],
  ];
}

/** Drop numeric claims the model made up (D5): stock/sold numbers not in FACTS. */
export function scrubUnbackedClaims(line: string, p: VideoAdPayload): string {
  const allowedStock = p.stockLeft !== undefined && p.stockLeft > 0 && p.stockLeft <= 50 ? p.stockLeft : null;
  let out = line.replace(SCARCITY_CLAIM, (m: string, n1?: string, n2?: string) => (allowedStock !== null && Number(n1 ?? n2) === allowedStock ? m : "habang may stock pa"));
  if (!p.freeShipping) out = out.replace(/free\s+(shipping|delivery)[^.!?]*/gi, "mabilis na delivery");
  return out.replace(/\s{2,}/g, " ").trim();
}

export function parseScript(raw: string, p: VideoAdPayload): VideoScript | null {
  const text = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let json: unknown;
  try {
    json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const parsed = scriptSchema.safeParse(json);
  if (!parsed.success) return null;
  const times = normalizeTiming(parsed.data.scenes, p.durationSec);
  const roles = ["hook", "body", "cta"] as const;
  const scenes = parsed.data.scenes.map((s, i) => ({
    role: roles[i]!,
    start: times[i]![0],
    end: times[i]![1],
    line: scrubUnbackedClaims(s.line, p),
    visual: s.visual?.trim() || DEFAULT_VISUALS[i]!,
  })) as VideoScript["scenes"];
  return { scenes, source: "llm" };
}

const DEFAULT_VISUALS = [
  "fast dynamic push-in on the product, bright pop of light, energetic",
  "slow orbit around the product, soft natural light sweeping across, premium feel",
  "gentle pull-back revealing the product centred, calm and clean, room for text",
];

/** Used when the LLM is unreachable twice or returns unusable JSON. */
export function templateScript(p: VideoAdPayload): VideoScript {
  const price = p.promoPrice !== undefined ? `${formatPeso(p.promoPrice)} na lang, dati ${formatPeso(p.price)}` : `${formatPeso(p.price)} lang`;
  const pay = p.paymentMethods.map((m) => PAYMENT_LABEL[m] ?? m).join(" o ");
  const urgency = p.stockLeft !== undefined && p.stockLeft > 0 && p.stockLeft <= 50 ? `${p.stockLeft} piraso na lang!` : "Habang may stock pa!";
  const times = normalizeTiming([{ start: 0, end: -1 }, { start: 0, end: -1 }, { start: 0, end: 0 }], p.durationSec);
  const lines = [
    `Uy, wait lang! Ito na ang ${p.productTitle} na hinahanap mo!`,
    `${p.discountLabel ? `${p.discountLabel}! ` : ""}${price} po.${p.freeShipping ? " Libre pa ang shipping via BayanGo!" : ""} ${urgency}`,
    `Order na po sa link! ${pay} available. ${p.shopName}, salamat po!`,
  ];
  const roles = ["hook", "body", "cta"] as const;
  return {
    source: "template",
    scenes: lines.map((line, i) => ({ role: roles[i]!, start: times[i]![0], end: times[i]![1], line, visual: DEFAULT_VISUALS[i]! })) as VideoScript["scenes"],
  };
}
