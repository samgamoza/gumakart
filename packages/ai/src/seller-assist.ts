/**
 * Phase 26: the AI seller assistant (ideas harvested from the palenkeAi prototype, built honestly).
 *
 *  - captions  → Facebook / Instagram / TikTok captions for a product or checkout link, link included
 *  - replies   → three suggested Taglish replies to a buyer message (the seller picks and edits)
 *  - advisor   → "Ask Guma": answers grounded ONLY in the shop facts we pass in (no invented numbers)
 *
 * Every output is validated and cleaned here; nothing is ever sent to a buyer automatically.
 * Without an AI key (dev/test) a deterministic template answer is returned so the UI still works.
 */
import { z } from "zod";
import { callLlm, resolveEffectiveModel } from "./providers/llm";
import { normalizePlan, resolveBudgetAwareModel, type AiTaskType } from "./plan-limits";

export type AssistTask = "captions" | "replies" | "advisor" | "supplier";

export interface CaptionsInput {
  shopName: string;
  productTitle: string;
  price?: number | null;
  details?: string;
  link: string;
}

export interface RepliesInput {
  shopName: string;
  buyerMessage: string;
  /** Short facts the reply may use: product names, prices, stock, delivery/payment options. */
  facts: string[];
  checkoutLink?: string | null;
}

export interface AdvisorFacts {
  shopName: string;
  periodDays: number;
  sales: number;
  orders: number;
  aov: number;
  previousSales: number;
  topProducts: Array<{ title: string; units: number; sales: number }>;
  restock: Array<{ title: string; stock: number; daysLeft: number | null; suggestedQty: number }>;
  pendingPayments: number;
  toShip: number;
}

export interface AdvisorInput {
  question: string;
  facts: AdvisorFacts;
}

/** Harvest H1: a reorder message to the seller's supplier (from the restock list). */
export interface SupplierInput {
  shopName: string;
  supplierName?: string | null;
  items: Array<{ title: string; qty: number; stock: number }>;
}

export type AssistInput = CaptionsInput | RepliesInput | AdvisorInput | SupplierInput;

export const captionsOutput = z.object({
  facebook: z.string().min(1),
  instagram: z.string().min(1),
  tiktok: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
});
export const repliesOutput = z.object({ replies: z.array(z.string().min(1)).min(1) });
export const advisorOutput = z.object({ answer: z.string().min(1), actions: z.array(z.string()).default([]) });
export const supplierOutput = z.object({ message: z.string().min(1) });

export type CaptionsOutput = z.infer<typeof captionsOutput>;
export type RepliesOutput = z.infer<typeof repliesOutput>;
export type AdvisorOutput = z.infer<typeof advisorOutput>;
export type SupplierOutput = z.infer<typeof supplierOutput>;

const TASK_TYPE: Record<AssistTask, AiTaskType> = { captions: "generation", replies: "chat", advisor: "chat", supplier: "chat" };
const MAX_TOKENS: Record<AssistTask, number> = { captions: 700, replies: 300, advisor: 600, supplier: 350 };

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** Strip control characters and anything that looks like HTML; outputs are plain text. */
const clean = (s: string) => s.replace(/<[^>]*>/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();

const SYSTEM = [
  "You help small Filipino online sellers. Write natural Taglish (mix of Filipino and English) unless the user writes in pure English.",
  "Be warm, short and specific. Never invent prices, stock, discounts, delivery times, reviews or sales numbers — use only the facts given.",
  "If a fact is missing, say so or leave it out. Reply with valid JSON only.",
].join(" ");

export function buildAssistPrompt(task: AssistTask, input: AssistInput): { system: string; user: string; maxTokens: number } {
  if (task === "captions") {
    const i = input as CaptionsInput;
    return {
      system: SYSTEM,
      maxTokens: MAX_TOKENS.captions,
      user: [
        `Shop: ${i.shopName}. Product: ${i.productTitle}.`,
        i.price != null ? `Price: ${peso(i.price)}.` : "No price given — do not mention a price.",
        i.details ? `Seller notes: ${clip(i.details, 600)}` : "",
        `Checkout link (must appear exactly once in each caption): ${i.link}`,
        'Return {"facebook": string (max 600 chars), "instagram": string (max 500 chars, include the link — not \"link sa bio\"), "tiktok": string (max 300 chars, punchy hook first), "hashtags": string[] (max 6, no #GumaKart)}.',
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }
  if (task === "replies") {
    const i = input as RepliesInput;
    return {
      system: SYSTEM,
      maxTokens: MAX_TOKENS.replies,
      user: [
        `Shop: ${i.shopName}. A buyer wrote: "${clip(i.buyerMessage, 800)}"`,
        i.facts.length ? `Facts you may use:\n- ${i.facts.slice(0, 15).map((f) => clip(f, 200)).join("\n- ")}` : "No product facts available — ask a clarifying question instead of guessing.",
        i.checkoutLink ? `If the buyer wants to order, include this link: ${i.checkoutLink}` : "",
        'Return {"replies": string[3]} — three different reply options, each under 280 characters, polite (po/opo), ready to send.',
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }
  if (task === "supplier") {
    const i = input as SupplierInput;
    return {
      system: SYSTEM,
      maxTokens: MAX_TOKENS.supplier,
      user: [
        `Write a short, polite Taglish reorder message from shop "${i.shopName}" to their supplier${i.supplierName ? ` (${i.supplierName})` : ""}.`,
        `Items and quantities to order (use EXACTLY these, one per line as "• item — qty pcs"):`,
        ...i.items.slice(0, 15).map((x) => `- ${clip(x.title, 120)}: ${x.qty} pcs`),
        "Ask them to confirm availability, price and the earliest delivery date. No prices or dates of your own.",
        'Return {"message": string (max 900 chars)}.',
      ].join("\n"),
    };
  }
  const i = input as AdvisorInput;
  return {
    system: `${SYSTEM} You are "Guma", a business advisor. Base every number on the SHOP FACTS. Give practical next steps a micro-seller can do this week.`,
    maxTokens: MAX_TOKENS.advisor,
    user: [`SHOP FACTS (JSON): ${JSON.stringify(i.facts)}`, `Question: ${clip(i.question, 500)}`, 'Return {"answer": string (max 900 chars), "actions": string[] (max 3 short next steps)}.'].join("\n"),
  };
}

// ─── cleaning ────────────────────────────────────────────────────────────────

function ensureLink(text: string, link: string): string {
  return text.includes(link) ? text : `${text.trimEnd()}\n\nOrder here 👉 ${link}`;
}

export function parseAssistOutput(task: "captions", raw: string, input: CaptionsInput): CaptionsOutput;
export function parseAssistOutput(task: "replies", raw: string, input: RepliesInput): RepliesOutput;
export function parseAssistOutput(task: "advisor", raw: string, input: AdvisorInput): AdvisorOutput;
export function parseAssistOutput(task: "supplier", raw: string, input: SupplierInput): SupplierOutput;
export function parseAssistOutput(task: AssistTask, raw: string, input: AssistInput): CaptionsOutput | RepliesOutput | AdvisorOutput | SupplierOutput;
export function parseAssistOutput(task: AssistTask, raw: string, input: AssistInput) {
  const json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  if (task === "captions") {
    const link = (input as CaptionsInput).link;
    const o = captionsOutput.parse(json);
    return {
      facebook: ensureLink(clip(clean(o.facebook), 700), link),
      instagram: ensureLink(clip(clean(o.instagram), 600), link),
      tiktok: ensureLink(clip(clean(o.tiktok), 400), link),
      hashtags: o.hashtags
        .map((h) => `#${clean(h).replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")}`)
        .filter((h) => h.length > 1 && h.toLowerCase() !== "#gumakart")
        .slice(0, 6),
    };
  }
  if (task === "replies") {
    const o = repliesOutput.parse(json);
    return { replies: [...new Set(o.replies.map((r) => clip(clean(r), 400)).filter(Boolean))].slice(0, 3) };
  }
  if (task === "supplier") {
    const i = input as SupplierInput;
    let message = clip(clean(supplierOutput.parse(json).message), 1200);
    // The quantities are the point of the message — if the model dropped any, append the exact list.
    const missing = i.items.filter((x) => !message.includes(String(x.qty)) || !message.toLowerCase().includes(x.title.toLowerCase().slice(0, 12)));
    if (missing.length) message += `\n\n${i.items.map((x) => `• ${x.title} — ${x.qty} pcs`).join("\n")}`;
    return { message };
  }
  const o = advisorOutput.parse(json);
  return { answer: clip(clean(o.answer), 1200), actions: o.actions.map((a) => clip(clean(a), 200)).filter(Boolean).slice(0, 3) };
}

// ─── no-key fallback (dev/test only; production refuses mocks in resolveEffectiveModel) ───

export function mockAssist(task: AssistTask, input: AssistInput): CaptionsOutput | RepliesOutput | AdvisorOutput | SupplierOutput {
  if (task === "captions") {
    const i = input as CaptionsInput;
    const price = i.price != null ? ` — ${peso(i.price)} lang!` : "";
    return {
      facebook: `✨ ${i.productTitle}${price}\n\nAvailable na sa ${i.shopName}. GCash, Maya o COD. Order here 👉 ${i.link}`,
      instagram: `${i.productTitle}${price} 🛍️\nGCash · Maya · COD\nOrder here 👉 ${i.link}`,
      tiktok: `POV: nahanap mo na ang ${i.productTitle} 😍${price} Order 👉 ${i.link}`,
      hashtags: ["#ShopLocal", "#SupportSmallBusiness", "#OnlineShopPH"],
    };
  }
  if (task === "replies") {
    const i = input as RepliesInput;
    const link = i.checkoutLink ? ` Pwede po kayo mag-order dito: ${i.checkoutLink}` : "";
    return {
      replies: [
        `Hi po! Salamat sa message 😊 Available pa po.${link}`,
        `Hello po! Ano pong size/variant at ilang piraso ang kailangan ninyo? Para ma-check ko agad.`,
        `Hi po! Para sa shipping fee, saan po ang delivery address ninyo (city/barangay)?`,
      ],
    };
  }
  if (task === "supplier") {
    const i = input as SupplierInput;
    return {
      message: [
        `Hi${i.supplierName ? ` ${i.supplierName}` : ""}! Si ${i.shopName} po ito. Gusto po sana naming mag-order ulit:`,
        "",
        ...i.items.map((x) => `• ${x.title} — ${x.qty} pcs`),
        "",
        "Pa-confirm po kung available, magkano, at kailan pinakamaagang ma-deliver. Salamat po! 🙏",
      ].join("\n"),
    };
  }
  const f = (input as AdvisorInput).facts;
  const top = f.topProducts[0];
  const low = f.restock.filter((r) => r.daysLeft != null && r.daysLeft <= 7);
  const change = f.previousSales > 0 ? Math.round(((f.sales - f.previousSales) / f.previousSales) * 100) : null;
  return {
    answer: [
      `Sa nakaraang ${f.periodDays} araw: ${peso(f.sales)} mula sa ${f.orders} order (average ${peso(Math.round(f.aov))}).`,
      change != null ? `${change >= 0 ? "Tumaas" : "Bumaba"} ng ${Math.abs(change)}% kumpara sa naunang ${f.periodDays} araw.` : "",
      top ? `Best seller: ${top.title} (${top.units} piraso).` : "Wala pang benta sa panahong ito.",
      low.length ? `Paubos na: ${low.map((r) => r.title).slice(0, 3).join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    actions: [
      top ? `I-post ulit ang ${top.title} na may checkout link.` : "Mag-post ng checkout link para sa best item mo.",
      low.length ? `Mag-restock ng ${low[0]!.title} (mga ${low[0]!.suggestedQty} piraso).` : "Tingnan ang stock bago ang payday.",
      f.pendingPayments ? `I-confirm ang ${f.pendingPayments} GCash/Maya payment na naghihintay.` : "Sagutin agad ang mga bagong message.",
    ],
  };
}

export interface AssistRunResult<T> {
  output: T;
  tokensUsed: number;
  model: string;
  provider: string;
}

/** Runs one assist task with the plan's (budget-aware) model. Throws on provider or parse failure. */
export async function runSellerAssist(
  task: AssistTask,
  input: AssistInput,
  opts: { plan?: string | null; tokensUsedThisMonth?: number } = {}
): Promise<AssistRunResult<CaptionsOutput | RepliesOutput | AdvisorOutput | SupplierOutput>> {
  const requested = resolveBudgetAwareModel(normalizePlan(opts.plan ?? "free"), TASK_TYPE[task], opts.tokensUsedThisMonth);
  const model = resolveEffectiveModel(requested);
  if (model === "mock") return { output: mockAssist(task, input), tokensUsed: 0, model: "mock", provider: "mock" };
  const prompt = buildAssistPrompt(task, input);
  const result = await callLlm({ model, system: prompt.system, user: prompt.user, jsonMode: true, maxTokens: prompt.maxTokens });
  return { output: parseAssistOutput(task, result.content, input), tokensUsed: result.tokensUsed ?? 0, model: result.model, provider: result.provider };
}

export function assistTaskType(task: AssistTask): AiTaskType {
  return TASK_TYPE[task];
}
