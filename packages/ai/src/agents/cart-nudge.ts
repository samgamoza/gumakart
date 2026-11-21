import { runLocalFirst, type GpuBridgeConfig } from "../gpu-bridge-client";
import { normalizePlan, resolveBudgetAwareModel } from "../plan-limits";
import { callLlm, resolveEffectiveModel } from "../providers/llm";
import { scrubClaims } from "./taglish-closer";

/**
 * Abandoned-cart / ghost-buyer nudge (AI suite Phase 3.3): one warm Taglish follow-up, 30 minutes
 * after the checkout link went out without payment. Honest by construction: never says the item
 * is "reserved" (checkout links don't hold stock) and offers COD only when the shop takes it.
 * Pro Live / Enterprise Vibe get an AI-personalised line (local Qwen3, cloud fallback);
 * Starter gets the template.
 */
export interface NudgeInput {
  buyerName: string | null;
  itemTitle: string;
  shopName: string;
  /** The buyer placed the order but hasn't paid (GCash/Maya/QRPh) vs never ordered (ghost). */
  stage: "unpaid_order" | "no_order";
  currentMethod: "gcash" | "maya" | "qrph" | "cod" | null;
  codAvailable: boolean;
  /** Mention BayanGo only when the shop actually delivers with it. */
  bayangoDelivery: boolean;
}

const METHOD: Record<string, string> = { gcash: "GCash", maya: "Maya", qrph: "QRPh", cod: "COD" };

export function offerCodSwitch(input: NudgeInput): boolean {
  return input.codAvailable && input.currentMethod !== "cod";
}

export function templateNudge(input: NudgeInput): string {
  const hi = input.buyerName ? `Hi ${input.buyerName.split(/\s+/)[0]}!` : "Hi po!";
  const item = input.itemTitle.slice(0, 80);
  const pay = input.currentMethod && input.currentMethod !== "cod" ? `sa ${METHOD[input.currentMethod]}` : "sa pag-checkout";
  const cod = offerCodSwitch(input) ? ` O gusto mo i-switch na lang natin sa Cash on Delivery (COD)${input.bayangoDelivery ? " via BayanGo" : ""}?` : "";
  return input.stage === "unpaid_order"
    ? `${hi} Nakita namin na hindi pa tapos ang bayad para sa ${item} mo. Need help ${pay}?${cod} 😊`
    : `${hi} Nakita namin na hindi mo pa natatapos ang order mo para sa ${item}. Need help ${pay}?${cod} 😊`;
}

export function buildNudgePrompt(input: NudgeInput): { system: string; user: string } {
  return {
    system: [
      "You write ONE short, warm follow-up chat message (max 2 sentences, 1 emoji) for a Filipino online shop, in natural Taglish with 'po'.",
      "The buyer got a checkout link 30+ minutes ago and hasn't finished. Offer help kindly — no pressure, no guilt-tripping.",
      "RULES: never say the item is reserved or held; never invent discounts, deadlines, stock counts or free shipping.",
      offerCodSwitch(input) ? "Offer switching to Cash on Delivery (COD) as an option." : "Do NOT mention COD.",
      input.bayangoDelivery ? "You may say delivery is via BayanGo." : "Do NOT mention any courier by name.",
      'Reply with JSON only: {"message":"..."}',
    ].join("\n"),
    user: [
      `Shop: ${input.shopName}`,
      `Buyer first name: ${input.buyerName?.split(/\s+/)[0] ?? "(unknown — just say Hi po)"}`,
      `Item: ${input.itemTitle}`,
      `Stage: ${input.stage === "unpaid_order" ? "order placed, payment not done" : "link opened or not, order not placed"}`,
      `Payment method on the link: ${input.currentMethod ? METHOD[input.currentMethod] : "any"}`,
    ].join("\n"),
  };
}

function parseMessage(raw: string): string | null {
  const t = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    const j = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as { message?: unknown };
    if (typeof j.message === "string" && j.message.trim().length >= 8) return j.message.trim().slice(0, 600);
  } catch {
    // not JSON
  }
  return null;
}

/** Strip anything the rules forbid even if the model wrote it. */
export function sanitizeNudge(text: string, input: NudgeInput): string {
  let out = scrubClaims(text, []).text;
  out = out.replace(/\b(?:naka-?reserve|reserved|nakareserba|hold(?:ing)?)\b[^.!?]*[.!?]?/gi, "").trim();
  if (!offerCodSwitch(input)) out = out.replace(/[^.!?]*\b(?:COD|cash on delivery)\b[^.!?]*[.!?]?/gi, "").trim();
  if (!input.bayangoDelivery) out = out.replace(/\s*via BayanGo/gi, "");
  return out.length >= 8 ? out : templateNudge(input);
}

export async function writeCartNudge(
  input: NudgeInput,
  opts: { personalised: boolean; tenantId: string; plan?: string | null; tokensUsedThisMonth?: number; bridge: GpuBridgeConfig | null }
): Promise<{ text: string; servedBy: "template" | "gpu-node" | "cloud" }> {
  if (!opts.personalised) return { text: templateNudge(input), servedBy: "template" };
  const prompt = buildNudgePrompt(input);
  try {
    const r = await runLocalFirst<{ text: string; servedBy: "gpu-node" | "cloud" | "template" }>({
      bridge: opts.bridge,
      request: {
        tenantId: opts.tenantId,
        purpose: "cart_nudge",
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        maxTokens: 200,
        temperature: 0.8,
        responseFormat: { type: "json_object" },
      },
      fromBridge: (res) => {
        const m = parseMessage(res.content);
        return m ? { text: m, servedBy: "gpu-node" } : null;
      },
      cloud: async () => {
        const model = resolveEffectiveModel(resolveBudgetAwareModel(normalizePlan(opts.plan ?? "free"), "chat", opts.tokensUsedThisMonth));
        if (model === "mock") return { text: templateNudge(input), servedBy: "template" };
        const res = await callLlm({ model, system: prompt.system, user: prompt.user, jsonMode: true, maxTokens: 200 });
        const m = parseMessage(res.content);
        return m ? { text: m, servedBy: "cloud" } : { text: templateNudge(input), servedBy: "template" };
      },
    });
    return { text: sanitizeNudge(r.result.text, input), servedBy: r.result.servedBy };
  } catch {
    return { text: templateNudge(input), servedBy: "template" };
  }
}
