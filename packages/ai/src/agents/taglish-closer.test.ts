import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BridgeUnavailableError } from "../gpu-bridge-client";
import { buildCloserSystemPrompt, knownAmounts, parseJsonAction, parseNativeToolCalls, runCloserTurn, scrubClaims, unknownPesoAmounts, type AgentStep, type CloserModel, type CloserTools, type TurnState } from "./taglish-closer";
import { offerCodSwitch, sanitizeNudge, templateNudge, type NudgeInput } from "./cart-nudge";

const ctx = { shopName: "Simply Sweet", paymentMethods: ["gcash", "cod"] as Array<"gcash" | "maya" | "qrph" | "cod">, buyerName: "Ana Cruz", platform: "messenger" as const };

function scripted(name: CloserModel["name"], steps: Array<AgentStep | Error>, seen: TurnState[] = []): CloserModel {
  let i = 0;
  return {
    name,
    async step(state) {
      seen.push(JSON.parse(JSON.stringify(state)));
      const s = steps[i++] ?? { type: "reply", text: "(no more steps)" };
      if (s instanceof Error) throw s;
      return { ...s, tokens: 10, model: name === "gpu-node" ? "qwen3-235b" : "gpt-4o-mini" };
    },
  };
}

function tools(calls: string[] = []): CloserTools {
  return {
    check_product_inventory: async (a) => {
      calls.push(`inv:${a.product_query}`);
      return { found: true, products: [{ product_id: "p1", title: "Ube Cheese Pandesal", variants: [{ variant_id: "v1", title: "Box of 12", price: 240, in_stock: true, stock_left: 7 }] }] };
    },
    quote_bayango_delivery: async (a) => {
      calls.push(`quote:${a.buyer_barangay_or_city}`);
      return { provider: "bayango", fee: 75, eta_minutes: 45, live_quote: true, free: false };
    },
    create_prefilled_checkout_link: async (a) => {
      calls.push(`link:${a.payment_method}`);
      return { ok: true, code: "abc2345", payment_method: a.payment_method };
    },
    escalate_to_human_seller: async (a) => {
      calls.push(`esc:${a.reason}`);
      return { ok: true };
    },
  };
}

const call = (name: string, args: Record<string, unknown>, id = "c1"): AgentStep => ({ type: "tool_calls", calls: [{ id, name: name as never, args }] });

describe("Taglish closer — the turn loop", () => {
  it("native tool calls on the GPU node: inventory → delivery → link, link URL ends up in the reply", async () => {
    const used: string[] = [];
    const seen: TurnState[] = [];
    const r = await runCloserTurn({
      ctx,
      history: [{ direction: "in", body: "HM po ube pandesal? Pasig ako. GCash po." }],
      tools: tools(used),
      primary: scripted("gpu-node", [
        call("check_product_inventory", { product_query: "ube pandesal" }),
        call("quote_bayango_delivery", { buyer_barangay_or_city: "Pasig City" }, "c2"),
        call("create_prefilled_checkout_link", { items: [{ product_id: "p1", variant_id: "v1", quantity: 2 }], payment_method: "gcash" }, "c3"),
        { type: "reply", text: "₱240 po per box, 7 pcs left! 2 boxes = ₱480 + ₱75 delivery = ₱555 po. Eto na link mo:" },
      ], seen),
      fallback: () => scripted("cloud", []),
      linkUrl: (x) => `https://kart.guma.one/c/${x.code}?ref=messenger&th=t1`,
    });
    assert.deepEqual(used, ["inv:ube pandesal", "quote:Pasig City", "link:gcash"]);
    assert.equal(r.servedBy, "gpu-node");
    assert.equal(r.checkoutUrl, "https://kart.guma.one/c/abc2345?ref=messenger&th=t1");
    assert.ok(r.reply.includes("7 pcs left"), "real stock number from the tool is kept");
    assert.ok(r.reply.endsWith("👉 https://kart.guma.one/c/abc2345?ref=messenger&th=t1"));
    assert.deepEqual(r.guards, []);
    assert.equal(r.tokens, 40);
    assert.equal(seen[3]!.turnMessages.filter((m) => m.role === "tool").length, 3, "tool results fed back");
  });

  it("node goes down mid-turn → the rest runs on the cloud with the tool results so far", async () => {
    const reasons: string[] = [];
    const cloudSeen: TurnState[] = [];
    const r = await runCloserTurn({
      ctx,
      history: [{ direction: "in", body: "avail pa po ube pandesal?" }],
      tools: tools(),
      primary: scripted("gpu-node", [call("check_product_inventory", { product_query: "ube pandesal" }), new BridgeUnavailableError("bridge returned 530", 530)]),
      fallback: () => scripted("cloud", [{ type: "reply", text: "Available pa po! ₱240 per box." }], cloudSeen),
      onFallback: (why) => reasons.push(why),
    });
    assert.deepEqual(reasons, ["unavailable"]);
    assert.equal(r.servedBy, "cloud");
    assert.equal(cloudSeen[0]!.toolLog.length, 1, "cloud sees the inventory result");
    assert.equal(cloudSeen[0]!.turnMessages.length, 0);
    assert.equal(r.reply, "Available pa po! ₱240 per box.");
  });

  it("price guard: an unchecked ₱ amount forces a tool call; a second miss is removed", async () => {
    const used: string[] = [];
    const seen: TurnState[] = [];
    const ok = await runCloserTurn({
      ctx,
      history: [{ direction: "in", body: "magkano po?" }],
      tools: tools(used),
      primary: scripted("gpu-node", [{ type: "reply", text: "₱199 lang po!" }, call("check_product_inventory", { product_query: "pandesal" }), { type: "reply", text: "₱240 po per box!" }], seen),
      fallback: () => scripted("cloud", []),
    });
    assert.equal(ok.reply, "₱240 po per box!");
    assert.deepEqual(ok.guards, ["price_recheck"]);
    assert.match(seen[1]!.correction!, /₱199/);
    const stubborn = await runCloserTurn({
      ctx,
      history: [{ direction: "in", body: "magkano po?" }],
      tools: tools(),
      primary: scripted("gpu-node", [{ type: "reply", text: "₱199 lang po!" }, { type: "reply", text: "₱199 lang po talaga!" }]),
      fallback: () => scripted("cloud", []),
    });
    assert.ok(!stubborn.reply.includes("199"));
    assert.deepEqual(stubborn.guards, ["price_recheck", "price_removed"]);
  });

  it("D5: invented stock counts, sold numbers and free shipping are scrubbed", async () => {
    const r = await runCloserTurn({
      ctx,
      history: [{ direction: "in", body: "legit po ba kayo?" }],
      tools: tools(),
      primary: scripted("gpu-node", [{ type: "reply", text: "Opo legit! 500+ sold na, last 3 pcs na lang, free shipping pa!" }]),
      fallback: () => scripted("cloud", []),
    });
    assert.ok(!/500\+ sold|last 3|free shipping/i.test(r.reply), r.reply);
    assert.deepEqual(r.guards.sort(), ["free_shipping_claim", "sold_claim", "stock_claim"]);
    const kept = scrubClaims("Free delivery po kasi above ₱1,000!", [{ id: "q", name: "quote_bayango_delivery", args: {}, result: { free: true } }]);
    assert.equal(kept.text, "Free delivery po kasi above ₱1,000!");
  });

  it("escalation is recorded; the step limit hands over instead of guessing", async () => {
    const used: string[] = [];
    const esc = await runCloserTurn({
      ctx,
      history: [{ direction: "in", body: "Pwede wholesale 200 boxes?" }],
      tools: tools(used),
      primary: scripted("gpu-node", [call("escalate_to_human_seller", { reason: "wholesale 200 boxes" }), { type: "reply", text: "Ipapasa ko po sa seller para sa wholesale price. Sasagot po siya agad!" }]),
      fallback: () => scripted("cloud", []),
    });
    assert.equal(esc.escalated, true);
    assert.deepEqual(used, ["esc:wholesale 200 boxes"]);
    const loopy = await runCloserTurn({
      ctx,
      history: [{ direction: "in", body: "hm?" }],
      tools: tools(used),
      primary: scripted("gpu-node", Array.from({ length: 12 }, (_v, i) => call("check_product_inventory", { product_query: `q${i}` }, `c${i}`))),
      fallback: () => scripted("cloud", []),
    });
    assert.equal(loopy.escalated, true);
    assert.ok(loopy.guards.includes("step_limit"));
    assert.ok(loopy.toolLog.length <= 5);
  });

  it("no model configured → polite holding reply via the fallback (never a made-up fact)", async () => {
    const reasons: string[] = [];
    const r = await runCloserTurn({ ctx, history: [{ direction: "in", body: "hi" }], tools: tools(), primary: null, fallback: () => scripted("mock", [{ type: "reply", text: "Hi po! Babalikan ka ng seller." }]), onFallback: (w) => reasons.push(w) });
    assert.equal(r.servedBy, "mock");
    assert.deepEqual(reasons, ["not_configured"]);
  });
});

describe("closer helpers", () => {
  it("system prompt lists only the shop's payment methods and the hard rules", () => {
    const p = buildCloserSystemPrompt(ctx);
    assert.match(p, /GCash, Cash on Delivery/);
    assert.ok(!/Maya/.test(p.split("Payment methods")[1]!.split("\n")[0]!));
    assert.match(p, /Never ask for card numbers/);
    assert.match(p, /Ana Cruz/);
  });
  it("parses JSON actions and native tool calls", () => {
    assert.deepEqual(parseJsonAction('```json\n{"action":"tool","tool":"quote_bayango_delivery","args":{"buyer_barangay_or_city":"Pasig"}}\n```'), { type: "tool_calls", calls: [{ id: "j1", name: "quote_bayango_delivery", args: { buyer_barangay_or_city: "Pasig" } }] });
    assert.deepEqual(parseJsonAction('{"action":"reply","message":"Salamat po!"}'), { type: "reply", text: "Salamat po!" });
    assert.deepEqual(parseJsonAction("<think>hmm</think>Sige po"), { type: "reply", text: "Sige po" });
    assert.deepEqual(parseJsonAction('{"action":"tool","tool":"delete_db"}').type, "reply", "unknown tools are never executed");
    assert.deepEqual(parseNativeToolCalls([{ id: "x", type: "function", function: { name: "check_product_inventory", arguments: '{"product_query":"tumbler"}' } }, { function: { name: "rm_rf" } }, { id: "y", function: { name: "escalate_to_human_seller", arguments: "{bad json" } }]), [
      { id: "x", name: "check_product_inventory", args: { product_query: "tumbler" } },
      { id: "y", name: "escalate_to_human_seller", args: {} },
    ]);
  });
  it("known amounts include tool prices, chat amounts and simple totals", () => {
    const k = knownAmounts({ history: [{ direction: "in", body: "budget ko ₱1,000" }], toolLog: [{ id: "a", name: "check_product_inventory", args: {}, result: { price: 240 } }, { id: "b", name: "quote_bayango_delivery", args: {}, result: { fee: 75 } }] });
    assert.deepEqual(unknownPesoAmounts("₱240 × 2 = ₱480, + ₱75 = ₱555. Budget ₱1,000 ok!", k), []);
    assert.deepEqual(unknownPesoAmounts("₱199 na lang", k), [199]);
  });
});

describe("cart nudge", () => {
  const base: NudgeInput = { buyerName: "Ana Cruz", itemTitle: "Ube Cheese Pandesal", shopName: "Simply Sweet", stage: "no_order", currentMethod: "gcash", codAvailable: true, bayangoDelivery: true };
  it("template: honest wording, COD offer only when possible", () => {
    const t = templateNudge(base);
    assert.match(t, /^Hi Ana! Nakita namin na hindi mo pa natatapos ang order mo para sa Ube Cheese Pandesal\. Need help sa GCash\? O gusto mo i-switch na lang natin sa Cash on Delivery \(COD\) via BayanGo\?/);
    assert.ok(!/reserve/i.test(t));
    assert.ok(!/COD/.test(templateNudge({ ...base, codAvailable: false })));
    assert.ok(!/BayanGo/.test(templateNudge({ ...base, bayangoDelivery: false })));
    assert.match(templateNudge({ ...base, stage: "unpaid_order" }), /hindi pa tapos ang bayad/);
    assert.equal(offerCodSwitch({ ...base, currentMethod: "cod" }), false);
  });
  it("sanitizes AI wording that breaks the rules", () => {
    const s = sanitizeNudge("Hi Ana! Naka-reserve pa yung order mo. Free shipping pa! Gusto mo COD na lang?", { ...base, codAvailable: false });
    assert.ok(!/reserve|free shipping|COD/i.test(s), s);
  });
});
