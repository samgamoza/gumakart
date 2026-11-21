import {
  BridgeRejectedError,
  BridgeUnavailableError,
  callBridgeChat,
  type BridgeChatRequest,
  type GpuBridgeConfig,
} from "../gpu-bridge-client";
import { normalizePlan, resolveBudgetAwareModel } from "../plan-limits";
import { callLlm, resolveEffectiveModel } from "../providers/llm";
import { SCARCITY_CLAIM } from "../scarcity";

/**
 * 24/7 Taglish AI Sales Closer (AI suite Phase 3.2). Pro Live / Enterprise Vibe.
 *
 * One buyer message → one reply, with up to MAX_STEPS tool calls in between:
 *   check_product_inventory · quote_bayango_delivery · create_prefilled_checkout_link · escalate_to_human_seller
 *
 * Model: Qwen3 on the home GPU node through the signed bridge (native OpenAI tool calls). If the
 * node is down, the rest of the turn runs on the cloud model with a JSON action protocol (the
 * cloud helpers have no tool-calling) — same tools, same guards.
 *
 * Grounding (D5 + prices): stock numbers only from inventory results, free delivery only when the
 * delivery quote says so, and a ₱ amount the model didn't get from a tool or the chat triggers one
 * corrective step, then gets removed.
 */

export const CLOSER_TOOL_NAMES = ["check_product_inventory", "quote_bayango_delivery", "create_prefilled_checkout_link", "escalate_to_human_seller"] as const;
export type CloserToolName = (typeof CLOSER_TOOL_NAMES)[number];
export const MAX_STEPS = 5;

export const CLOSER_TOOL_SPECS = [
  {
    type: "function",
    function: {
      name: "check_product_inventory",
      description: "Look up a product's real price, options and stock in this shop. Call before stating any price or availability.",
      parameters: {
        type: "object",
        properties: {
          product_query: { type: "string", description: "What the buyer is asking about, in their words (e.g. 'ube pandesal', 'black tumbler 40oz')." },
          product_id: { type: "string", description: "Exact product id from an earlier result, if known." },
        },
        required: ["product_query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "quote_bayango_delivery",
      description: "Delivery fee and ETA to the buyer's barangay/city (BayanGo first, Lalamove outside BayanGo's zone, else the shop's rate).",
      parameters: {
        type: "object",
        properties: {
          buyer_barangay_or_city: { type: "string", description: "e.g. 'Brgy. San Antonio, Pasig City'" },
          buyer_address: { type: "string", description: "Street/house if the buyer gave it." },
          subtotal: { type: "number", description: "Order subtotal in pesos (for the shop's free-delivery minimum)." },
        },
        required: ["buyer_barangay_or_city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_prefilled_checkout_link",
      description: "Make a 1-tap checkout link with the chosen items, payment method and the buyer's details pre-filled. Use when the buyer is ready to order.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { product_id: { type: "string" }, variant_id: { type: "string" }, quantity: { type: "integer", minimum: 1, maximum: 99 } },
              required: ["product_id", "quantity"],
            },
          },
          payment_method: { type: "string", enum: ["gcash", "maya", "qrph", "cod"] },
          buyer: {
            type: "object",
            properties: {
              name: { type: "string" },
              phone: { type: "string" },
              address_line: { type: "string" },
              barangay: { type: "string" },
              city: { type: "string" },
              landmark: { type: "string" },
            },
          },
        },
        required: ["items", "payment_method"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human_seller",
      description:
        "Hand the chat to the seller and stop replying: wholesale/bulk or custom terms, complaints, refunds, wrong/damaged orders, payment disputes, anything you can't answer from the tools, or the buyer asks for a person.",
      parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    },
  },
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CloserShopContext {
  shopName: string;
  /** Payment methods the shop can take right now (chat names). */
  paymentMethods: Array<"gcash" | "maya" | "qrph" | "cod">;
  buyerName: string | null;
  platform: "messenger" | "instagram" | "whatsapp";
  now?: Date;
}

export interface CloserHistoryMessage {
  direction: "in" | "out";
  body: string;
}

export interface CloserTools {
  check_product_inventory(args: { product_query?: string; product_id?: string }): Promise<unknown>;
  quote_bayango_delivery(args: { buyer_barangay_or_city: string; buyer_address?: string; subtotal?: number }): Promise<unknown>;
  create_prefilled_checkout_link(args: {
    items: Array<{ product_id: string; variant_id?: string; quantity: number }>;
    payment_method: "gcash" | "maya" | "qrph" | "cod";
    buyer?: { name?: string; phone?: string; address_line?: string; barangay?: string; city?: string; landmark?: string };
  }): Promise<unknown>;
  escalate_to_human_seller(args: { reason: string }): Promise<unknown>;
}

export interface CloserToolCall {
  id: string;
  name: CloserToolName;
  args: Record<string, unknown>;
}

export type AgentStep = { type: "tool_calls"; calls: CloserToolCall[]; assistantMessage?: Record<string, unknown> } | { type: "reply"; text: string };

/** One model call given the conversation so far. Throws BridgeUnavailableError to switch to cloud. */
export interface CloserModel {
  name: "gpu-node" | "cloud" | "mock";
  step(state: TurnState): Promise<AgentStep & { tokens?: number; model?: string }>;
}

export interface ToolLogEntry {
  id: string;
  name: CloserToolName;
  args: Record<string, unknown>;
  result: unknown;
}

export interface TurnState {
  system: string;
  history: CloserHistoryMessage[];
  /** Native-tools transcript for this turn (assistant tool_calls + tool results). */
  turnMessages: BridgeChatRequest["messages"];
  toolLog: ToolLogEntry[];
  /** Extra instruction after a guard rejected a draft reply. */
  correction?: string;
}

export interface CloserResult {
  reply: string;
  toolLog: ToolLogEntry[];
  servedBy: "gpu-node" | "cloud" | "mock";
  model: string;
  tokens: number;
  checkoutUrl: string | null;
  escalated: boolean;
  /** Guards that changed the reply (for logs / evaluation). */
  guards: string[];
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const PAY_LABEL: Record<string, string> = { gcash: "GCash", maya: "Maya", qrph: "QRPh (any bank/e-wallet QR)", cod: "Cash on Delivery (COD)" };

export function buildCloserSystemPrompt(ctx: CloserShopContext): string {
  const now = (ctx.now ?? new Date()).toLocaleString("en-PH", { timeZone: "Asia/Manila", weekday: "short", hour: "numeric", minute: "2-digit" });
  return [
    `You are the friendly 24/7 sales assistant of "${ctx.shopName}", a Filipino online shop, chatting on ${ctx.platform === "whatsapp" ? "WhatsApp" : ctx.platform === "instagram" ? "Instagram" : "Messenger"}.`,
    `It is ${now} in Manila.${ctx.buyerName ? ` The buyer's name is ${ctx.buyerName}.` : ""}`,
    "Speak like a warm, helpful Pinoy seller: natural Taglish (mirror the buyer — English if they write English), 'po' politely, short replies (1–3 sentences), at most one emoji.",
    "Goal: answer questions, handle objections kindly (price, legit?, delivery time, COD), and close the sale with a checkout link.",
    "",
    "TOOLS — use them, never guess:",
    "- check_product_inventory before stating any price, option or availability.",
    "- quote_bayango_delivery when the buyer asks about shipping fee/ETA — ask for their barangay and city first if you don't have them.",
    "- create_prefilled_checkout_link when the buyer wants to order: you need the items (product/option + quantity) and a payment method. Collect name, mobile number and address if they offer them, but don't block on them — the checkout page asks too.",
    "- escalate_to_human_seller for wholesale/bulk or custom terms, complaints, refunds, wrong or damaged orders, payment disputes, anything the tools can't answer, or when the buyer wants a person. Then tell the buyer the seller will reply soon.",
    "",
    "HARD RULES:",
    "- Only say facts that came from tools or from this chat. Never invent prices, stock counts, 'sold' numbers, discounts, delivery times or free shipping.",
    "- Stock: say a number only if the inventory result gave stock_left; otherwise just 'available'/'out of stock'.",
    "- Free delivery only if the delivery quote says free=true.",
    `- Payment methods this shop accepts: ${ctx.paymentMethods.length ? ctx.paymentMethods.map((m) => PAY_LABEL[m]).join(", ") : "none set up — escalate payment questions"}. Offer only these.`,
    "- Never ask for card numbers, CVV, OTPs, passwords or IDs. Only name, mobile number and delivery address.",
    "- Never promise reservations or holds — stock isn't reserved until the order is placed.",
    "- When you create a checkout link, put the link in your reply.",
  ].join("\n");
}

/** JSON action protocol for models without native tool calls (cloud fallback). */
export const JSON_PROTOCOL = [
  "Respond with ONE JSON object only, either:",
  '  {"action":"tool","tool":"<check_product_inventory|quote_bayango_delivery|create_prefilled_checkout_link|escalate_to_human_seller>","args":{...}}',
  '  {"action":"reply","message":"<your reply to the buyer>"}',
  "Tool argument shapes:",
  '  check_product_inventory {"product_query": string, "product_id"?: string}',
  '  quote_bayango_delivery {"buyer_barangay_or_city": string, "buyer_address"?: string, "subtotal"?: number}',
  '  create_prefilled_checkout_link {"items":[{"product_id": string, "variant_id"?: string, "quantity": number}], "payment_method": "gcash"|"maya"|"qrph"|"cod", "buyer"?: {"name","phone","address_line","barangay","city","landmark"}}',
  '  escalate_to_human_seller {"reason": string}',
].join("\n");

export function transcriptForCloud(state: TurnState): string {
  const convo = state.history.map((m) => `${m.direction === "in" ? "Buyer" : "You"}: ${m.body}`).join("\n");
  const tools = state.toolLog.map((t) => `- ${t.name}(${JSON.stringify(t.args)}) → ${JSON.stringify(t.result)}`).join("\n");
  return [`CONVERSATION (latest last):\n${convo}`, tools ? `TOOL RESULTS THIS TURN:\n${tools}` : "", state.correction ? `CORRECTION: ${state.correction}` : "", "Decide your next step."]
    .filter(Boolean)
    .join("\n\n");
}

// ─── Parsing model output ────────────────────────────────────────────────────

function isToolName(n: unknown): n is CloserToolName {
  return typeof n === "string" && (CLOSER_TOOL_NAMES as readonly string[]).includes(n);
}

/** {"action":"tool"|"reply",…} → step. Plain text → reply. */
export function parseJsonAction(text: string, idPrefix = "j"): AgentStep {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(cleaned.slice(start, end + 1)) as { action?: string; tool?: string; args?: Record<string, unknown>; message?: string };
      if (j.action === "tool" && isToolName(j.tool)) return { type: "tool_calls", calls: [{ id: `${idPrefix}1`, name: j.tool, args: j.args ?? {} }] };
      if (typeof j.message === "string" && j.message.trim()) return { type: "reply", text: j.message.trim() };
    } catch {
      // fall through: treat as plain text
    }
  }
  return { type: "reply", text: cleaned };
}

/** OpenAI tool_calls → our calls (bad JSON arguments become {}). */
export function parseNativeToolCalls(raw: unknown[]): CloserToolCall[] {
  const out: CloserToolCall[] = [];
  raw.forEach((c, i) => {
    const call = c as { id?: string; function?: { name?: string; arguments?: string | Record<string, unknown> } };
    const name = call.function?.name;
    if (!isToolName(name)) return;
    let args: Record<string, unknown> = {};
    const a = call.function?.arguments;
    if (typeof a === "string") {
      try {
        args = JSON.parse(a) as Record<string, unknown>;
      } catch {
        args = {};
      }
    } else if (a && typeof a === "object") args = a;
    out.push({ id: call.id ?? `call_${i}`, name, args });
  });
  return out;
}

// ─── Models ──────────────────────────────────────────────────────────────────

export function bridgeCloserModel(bridge: GpuBridgeConfig, tenantId: string): CloserModel {
  return {
    name: "gpu-node",
    async step(state) {
      const messages: BridgeChatRequest["messages"] = [
        { role: "system", content: state.system },
        ...state.history.map((m) => ({ role: (m.direction === "in" ? "user" : "assistant") as "user" | "assistant", content: m.body })),
        ...state.turnMessages,
        ...(state.correction ? [{ role: "system" as const, content: `CORRECTION: ${state.correction}` }] : []),
      ];
      const r = await callBridgeChat(bridge, { tenantId, purpose: "dm_closer", messages, tools: [...CLOSER_TOOL_SPECS], maxTokens: 500, temperature: 0.4 });
      const tokens = r.usage.promptTokens + r.usage.completionTokens;
      const calls = parseNativeToolCalls(r.toolCalls);
      if (calls.length) {
        return { type: "tool_calls", calls, assistantMessage: { role: "assistant", content: r.content ?? "", tool_calls: r.toolCalls as Array<Record<string, unknown>> }, tokens, model: r.model };
      }
      // vLLM without auto tool choice may answer with our JSON protocol or plain text.
      return { ...parseJsonAction(r.content, "b"), tokens, model: r.model };
    },
  };
}

export function cloudCloserModel(opts: { plan?: string | null; tokensUsedThisMonth?: number }): CloserModel {
  const requested = resolveBudgetAwareModel(normalizePlan(opts.plan ?? "free"), "chat", opts.tokensUsedThisMonth);
  const model = resolveEffectiveModel(requested);
  if (model === "mock") return mockCloserModel();
  return {
    name: "cloud",
    async step(state) {
      const r = await callLlm({ model, system: `${state.system}\n\n${JSON_PROTOCOL}`, user: transcriptForCloud(state), jsonMode: true, maxTokens: 500 });
      return { ...parseJsonAction(r.content, `c${state.toolLog.length}`), tokens: r.tokensUsed ?? 0, model: r.model };
    },
  };
}

/** No LLM configured (dev): a polite holding reply, never a made-up fact. */
export function mockCloserModel(): CloserModel {
  return {
    name: "mock",
    async step() {
      return { type: "reply", text: "Hi po! Salamat sa message 😊 Babalikan ka po ng seller namin sa lalong madaling panahon.", tokens: 0, model: "mock" };
    },
  };
}

// ─── Guards ──────────────────────────────────────────────────────────────────

function numbersIn(value: unknown, out: Set<number>): void {
  if (typeof value === "number" && Number.isFinite(value)) out.add(Math.round(value * 100) / 100);
  else if (typeof value === "string") {
    for (const m of value.matchAll(/₱?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g)) out.add(Number(`${m[1]!.replace(/,/g, "")}${m[2] ? `.${m[2]}` : ""}`));
  } else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
}

/** Peso amounts the model may say: from tool results, the chat, and simple totals (price×qty + fee). */
export function knownAmounts(state: Pick<TurnState, "history" | "toolLog">): Set<number> {
  const base = new Set<number>();
  state.toolLog.forEach((t) => numbersIn(t.result, base));
  state.history.forEach((m) => numbersIn(m.body, base));
  const prices = [...base].filter((n) => n > 0 && n < 1_000_000);
  const out = new Set(base);
  for (const p of prices) for (let q = 2; q <= 10; q += 1) out.add(Math.round(p * q * 100) / 100);
  const list = [...out].filter((n) => n > 0);
  for (const a of list.slice(0, 120)) for (const b of prices.slice(0, 40)) out.add(Math.round((a + b) * 100) / 100);
  return out;
}

export function unknownPesoAmounts(reply: string, known: Set<number>): number[] {
  const bad: number[] = [];
  for (const m of reply.matchAll(/(?:₱|PHP\s?|Php\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g)) {
    const n = Number(`${m[1]!.replace(/,/g, "")}${m[2] ? `.${m[2]}` : ""}`);
    if (![...known].some((k) => Math.abs(k - n) < 0.01)) bad.push(n);
  }
  return bad;
}


/** D5: stock counts only when the inventory tool returned that exact number; free delivery only when quoted free. */
export function scrubClaims(reply: string, toolLog: ToolLogEntry[]): { text: string; changed: string[] } {
  const changed: string[] = [];
  const stock = new Set<number>();
  let freeQuoted = false;
  for (const t of toolLog) {
    if (t.name === "check_product_inventory") {
      const found = JSON.stringify(t.result ?? {});
      for (const m of found.matchAll(/"stock_left":(\d+)/g)) stock.add(Number(m[1]));
    }
    if (t.name === "quote_bayango_delivery" && (t.result as { free?: boolean } | null)?.free === true) freeQuoted = true;
  }
  let text = reply.replace(SCARCITY_CLAIM, (m: string, n1?: string, n2?: string) => {
    if (stock.has(Number(n1 ?? n2))) return m;
    changed.push("stock_claim");
    return "limited stock na lang po";
  });
  text = text.replace(/\b\d{2,6}\+?\s*(?:sold|nabenta|orders?)\b/gi, () => {
    changed.push("sold_claim");
    return "";
  });
  if (!freeQuoted) {
    text = text.replace(/\b(?:free|libreng?)\s+(?:shipping|delivery|sf)\b/gi, () => {
      changed.push("free_shipping_claim");
      return "delivery";
    });
  }
  return { text: text.replace(/[ \t]{2,}/g, " ").trim(), changed };
}

// ─── The turn ────────────────────────────────────────────────────────────────

export async function runCloserTurn(input: {
  ctx: CloserShopContext;
  history: CloserHistoryMessage[];
  tools: CloserTools;
  primary: CloserModel | null;
  fallback: () => CloserModel;
  onFallback?: (reason: string, error?: unknown) => void;
  /** Builds the buyer-facing URL for a created link (adds ?ref=…&th=…). */
  linkUrl?: (result: { code?: string; url?: string }) => string | null;
}): Promise<CloserResult> {
  const state: TurnState = { system: buildCloserSystemPrompt(input.ctx), history: input.history.slice(-20), turnMessages: [], toolLog: [] };
  let model: CloserModel = input.primary ?? input.fallback();
  if (!input.primary) input.onFallback?.("not_configured");
  let tokens = 0;
  let modelName: string = model.name;
  const guards: string[] = [];
  let checkoutUrl: string | null = null;
  let escalated = false;
  let corrected = false;

  for (let step = 0; step < MAX_STEPS + 2; step += 1) {
    let out: AgentStep & { tokens?: number; model?: string };
    try {
      out = await model.step(state);
    } catch (error) {
      if (model.name === "gpu-node" && (error instanceof BridgeUnavailableError || error instanceof BridgeRejectedError || error instanceof TypeError)) {
        input.onFallback?.(error instanceof BridgeUnavailableError ? "unavailable" : "rejected", error);
        model = input.fallback();
        // The cloud protocol rebuilds the transcript from toolLog; drop native-only messages.
        state.turnMessages = [];
        continue;
      }
      throw error;
    }
    tokens += out.tokens ?? 0;
    modelName = out.model ?? modelName;

    if (out.type === "tool_calls") {
      if (state.toolLog.length >= MAX_STEPS) {
        state.correction = "You have used enough tools. Reply to the buyer now with what you know.";
        continue;
      }
      if (out.assistantMessage) state.turnMessages.push(out.assistantMessage as BridgeChatRequest["messages"][number]);
      for (const call of out.calls.slice(0, 3)) {
        let result: unknown;
        try {
          result = await input.tools[call.name](call.args as never);
        } catch (error) {
          result = { ok: false, error: error instanceof Error ? error.message.slice(0, 200) : "tool failed" };
        }
        if (call.name === "create_prefilled_checkout_link") {
          const r = result as { ok?: boolean; code?: string; url?: string };
          if (r?.ok) {
            checkoutUrl = input.linkUrl ? input.linkUrl(r) : r.url ?? null;
            if (checkoutUrl) result = { ...(result as object), url: checkoutUrl };
          }
        }
        if (call.name === "escalate_to_human_seller" && (result as { ok?: boolean })?.ok !== false) escalated = true;
        state.toolLog.push({ id: call.id, name: call.name, args: call.args, result });
        state.turnMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 4000) });
      }
      continue;
    }

    // Reply: grounding checks.
    let reply = out.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const unknown = unknownPesoAmounts(reply, knownAmounts(state));
    if (unknown.length && !corrected) {
      corrected = true;
      guards.push("price_recheck");
      state.correction = `Your draft mentioned ₱${unknown.join(", ₱")} which no tool returned. Call check_product_inventory (or quote_bayango_delivery) and use only those numbers.`;
      continue;
    }
    if (unknown.length) {
      guards.push("price_removed");
      reply = reply.replace(/(?:₱|PHP\s?|Php\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g, (m, n: string) =>
        unknown.includes(Number(n.replace(/,/g, ""))) ? "(see the price on the link)" : m
      );
    }
    const scrubbed = scrubClaims(reply, state.toolLog);
    guards.push(...scrubbed.changed);
    reply = scrubbed.text;
    if (checkoutUrl && !reply.includes(checkoutUrl)) reply = `${reply}\n👉 ${checkoutUrl}`;
    if (!reply) reply = escalated ? "Salamat po! Ico-connect ko kayo sa seller namin, sasagot po siya agad." : "Salamat po! Ano pong item ang hanap ninyo? 😊";
    return { reply: reply.slice(0, 1000), toolLog: state.toolLog, servedBy: model.name, model: modelName, tokens, checkoutUrl, escalated, guards };
  }

  // Ran out of steps without a reply: hand over rather than guess.
  guards.push("step_limit");
  if (!escalated) {
    try {
      await input.tools.escalate_to_human_seller({ reason: "The AI couldn't finish answering this chat." });
      escalated = true;
    } catch {
      // ignore — the holding reply below still goes out
    }
  }
  return {
    reply: "Salamat po sa paghihintay! Ipapasa ko po ito sa seller namin para masagot kayo nang tama. 🙏",
    toolLog: state.toolLog,
    servedBy: model.name,
    model: modelName,
    tokens,
    checkoutUrl,
    escalated,
    guards,
  };
}
