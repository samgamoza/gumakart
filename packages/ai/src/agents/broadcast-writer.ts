import { runLocalFirst, type GpuBridgeConfig } from "../gpu-bridge-client";
import { normalizePlan, resolveBudgetAwareModel } from "../plan-limits";
import { callLlm, resolveEffectiveModel } from "../providers/llm";
import { scrubClaims } from "./taglish-closer";

/**
 * AI suite Phase 4.2 — Qwen3 polishes the seller's payday / restock broadcast into warm Taglish,
 * once per campaign (the seller sees and approves the result). Per-buyer personalisation is the
 * {name} / {item} / {link} placeholders, filled at send time — so every buyer gets their own name,
 * their last item and their own reorder link without one LLM call per message.
 * Honest by construction (D5): invented stock counts, "sold" numbers and free shipping are scrubbed.
 */
export type BroadcastKind = "payday" | "restock" | "custom";

export interface BroadcastDraftInput {
  draft: string;
  kind: BroadcastKind;
  shopName: string;
  productTitle?: string | null;
  channel: "messenger" | "instagram" | "whatsapp";
}

export const BROADCAST_PLACEHOLDERS = ["{name}", "{item}", "{link}", "{shop}"] as const;

export function defaultBroadcastDraft(kind: BroadcastKind, productTitle?: string | null): string {
  if (kind === "payday")
    return "Hi {name}! Payday na! 🎉 Na-miss ka namin sa {shop}. Gusto mo ulit ng {item}? Isang tap lang, naka-ready na ang order mo: {link}";
  if (kind === "restock")
    return `Hi {name}! Good news — back in stock na ang ${productTitle ?? "favorite mo"} sa {shop}! 🙌 Order ka na habang meron pa: {link}`;
  return "Hi {name}! May bago sa {shop} para sa'yo 😊 Silipin mo dito: {link}";
}

export function buildBroadcastPrompt(input: BroadcastDraftInput): { system: string; user: string } {
  return {
    system: [
      "You polish ONE short promotional chat message for a Filipino online shop, in natural, warm Taglish (with 'po' where natural).",
      `Channel: ${input.channel}. Max 3 short sentences, at most 2 emojis, no hashtags.`,
      "KEEP these placeholders exactly as written (curly braces included): {name}, {item}, {link}, {shop}. The message MUST contain {link} once.",
      "NEVER invent discounts, prices, deadlines, stock counts, 'sold' numbers or free shipping. Don't promise anything the draft doesn't say.",
      input.kind === "payday" ? "Theme: payday (buyers just got paid) — friendly reminder to reorder their favorite." : "",
      input.kind === "restock" ? `Theme: the product "${input.productTitle ?? "item"}" is back in stock.` : "",
      'Reply with JSON only: {"message":"..."}',
    ]
      .filter(Boolean)
      .join("\n"),
    user: `Shop: ${input.shopName}\nSeller's draft:\n${input.draft.slice(0, 800)}`,
  };
}

function parseMessage(raw: string): string | null {
  const t = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    const j = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as { message?: unknown };
    if (typeof j.message === "string" && j.message.trim().length >= 10) return j.message.trim();
  } catch {
    // not JSON
  }
  return null;
}

/** Keep only allowed placeholders, guarantee {link}, scrub unbacked claims, cap the length. */
export function sanitizeBroadcast(text: string, fallback: string): { text: string; guards: string[] } {
  const scrub = scrubClaims(text, []);
  let out = scrub.text.replace(/\{(?!name\}|item\}|link\}|shop\})[^}]{0,30}\}/gi, "").replace(/\s{2,}/g, " ").trim();
  const guards = [...scrub.changed];
  if (!/\{link\}/i.test(out)) {
    out = `${out} {link}`.trim();
    guards.push("link_added");
  }
  if (out.replace(/\{link\}/gi, "").trim().length < 10) return { text: fallback, guards: [...guards, "fallback"] };
  return { text: out.slice(0, 700), guards };
}

export async function polishBroadcast(
  input: BroadcastDraftInput,
  opts: { tenantId: string; bridge: GpuBridgeConfig | null; plan?: string | null; tokensUsedThisMonth?: number }
): Promise<{ text: string; servedBy: "gpu-node" | "cloud" | "template"; guards: string[]; tokens: number }> {
  const fallback = sanitizeBroadcast(input.draft || defaultBroadcastDraft(input.kind, input.productTitle), defaultBroadcastDraft(input.kind, input.productTitle)).text;
  const prompt = buildBroadcastPrompt(input);
  try {
    const r = await runLocalFirst<{ text: string; servedBy: "gpu-node" | "cloud" | "template"; tokens: number }>({
      bridge: opts.bridge,
      request: {
        tenantId: opts.tenantId,
        purpose: "broadcast_copy",
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        maxTokens: 300,
        temperature: 0.7,
        responseFormat: { type: "json_object" },
      },
      fromBridge: (res) => {
        const m = parseMessage(res.content);
        return m ? { text: m, servedBy: "gpu-node", tokens: res.usage.promptTokens + res.usage.completionTokens } : null;
      },
      cloud: async () => {
        const model = resolveEffectiveModel(resolveBudgetAwareModel(normalizePlan(opts.plan ?? "free"), "chat", opts.tokensUsedThisMonth));
        if (model === "mock") return { text: fallback, servedBy: "template", tokens: 0 };
        const res = await callLlm({ model, system: prompt.system, user: prompt.user, jsonMode: true, maxTokens: 300 });
        const m = parseMessage(res.content);
        return m ? { text: m, servedBy: "cloud", tokens: res.tokensUsed ?? 0 } : { text: fallback, servedBy: "template", tokens: 0 };
      },
    });
    const clean = sanitizeBroadcast(r.result.text, fallback);
    return { text: clean.text, servedBy: r.result.servedBy, guards: clean.guards, tokens: r.result.tokens };
  } catch {
    return { text: fallback, servedBy: "template", guards: ["fallback"], tokens: 0 };
  }
}
