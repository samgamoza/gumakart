import { NextResponse } from "next/server";
import { z } from "zod";
import { createAiGenerator } from "@gumakart/ai";
import {
  getOrCreateAssistantCheckoutLink,
  getTenantIdBySlug,
  getTenantStorefrontBySlug,
  listShopChatMessages,
  recordAiUsage,
  resolveShopAssistantSettings,
  resolveTenantPaymentsSettings,
  saveShopChatMessage,
} from "@gumakart/db";
import { resolveShopTheme } from "@gumakart/storefront-themes";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { assertAiQuota } from "@/lib/ai-quota";
import { matchProductForMessage } from "@/lib/chat-product-match";

const postSchema = z.object({
  tenantSlug: z.string().min(1),
  sessionId: z.string().min(8).max(64),
  message: z.string().min(1).max(2000),
  /** Prefer human seller reply path; AI may still answer when enabled. */
  mode: z.enum(["auto", "seller"]).optional().default("auto"),
  orderNumber: z.string().max(64).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantSlug = searchParams.get("tenantSlug") ?? "";
    const sessionId = searchParams.get("sessionId") ?? "";
    if (!tenantSlug || sessionId.length < 8) {
      return NextResponse.json({ ok: false, error: "Missing session." }, { status: 400 });
    }

    const tenantId = await getTenantIdBySlug(tenantSlug);
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    }

    const messages = await listShopChatMessages({ tenantId, sessionId });
    return NextResponse.json({
      ok: true,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role === "user" ? "buyer" : m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    });
  } catch (error) {
    console.error("Shop chat GET error:", error);
    return NextResponse.json({ ok: false, error: "Chat failed." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`chat:${clientIpFrom(request)}`, {
      limit: 20,
      windowSeconds: 60,
    });
    if (!limited.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "Slow down a little!",
          reply: "You're sending messages too quickly — give me a few seconds to catch up!",
        },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
      );
    }

    const body = postSchema.parse(await request.json());
    const tenant = await getTenantStorefrontBySlug(body.tenantSlug);
    if (!tenant) {
      return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    }

    const assistant = resolveShopAssistantSettings(
      tenant.settingsJson as Record<string, unknown>
    );
    if (!assistant.enabled && !assistant.humanInbox) {
      return NextResponse.json({ ok: false, error: "Chat disabled." }, { status: 403 });
    }

    const tenantId = await getTenantIdBySlug(body.tenantSlug);
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    }

    const content = body.orderNumber
      ? `[Order ${body.orderNumber}] ${body.message}`
      : body.message;

    await saveShopChatMessage({
      tenantId,
      sessionId: body.sessionId,
      role: "buyer",
      content,
    });

    // Human-first path: acknowledge; seller replies from admin inbox.
    if (body.mode === "seller" || !assistant.enabled) {
      const reply = body.orderNumber
        ? `Got it — your message about order ${body.orderNumber} was sent to ${tenant.name}. They’ll reply in this chat. If you already paid, include your GCash/Maya reference or say you uploaded a screenshot.`
        : `Got it — your message was sent to ${tenant.name}. They’ll reply in this chat (usually within business hours).`;

      await saveShopChatMessage({
        tenantId,
        sessionId: body.sessionId,
        role: "assistant",
        content: reply,
      });
      return NextResponse.json({ ok: true, reply, humanInbox: true });
    }

    const quota = await assertAiQuota(tenantId, "chat");
    if (!quota.allowed) {
      const reply =
        "Our auto-assistant is resting for today. Your message was still saved — the seller can reply here.";
      await saveShopChatMessage({
        tenantId,
        sessionId: body.sessionId,
        role: "assistant",
        content: reply,
      });
      return NextResponse.json({ ok: true, reply, humanInbox: true });
    }

    const theme = resolveShopTheme(tenant.themeJson, tenant.name);
    const storefrontBase = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3010";
    const shopLink = `${storefrontBase}/${tenant.slug}?utm_source=shop_assistant`;

    // Checkout Closer: when the buyer names one product, send a checkout link for exactly that
    // product. The match and the price come from the catalog, never from the model.
    const activeProducts = tenant.products.filter((p) => p.status === "active");
    const asked = body.orderNumber ? null : matchProductForMessage(body.message, activeProducts);
    let askedLink: string | null = null;
    if (asked && asked.available) {
      if (asked.variants.length > 1) {
        // Sizes/options to pick: the product page is where the buyer chooses one.
        askedLink = `${storefrontBase}/${tenant.slug}/products/${asked.slug}?utm_source=shop_assistant`;
      } else {
        const link = await getOrCreateAssistantCheckoutLink(tenantId, {
          productId: asked.id,
          chatSessionId: body.sessionId,
        }).catch((error) => {
          console.error("Shop chat: could not make a checkout link:", error);
          return null;
        });
        if (link) askedLink = `${storefrontBase}/c/${link.code}`;
      }
    }
    const askedPrice = asked ? `₱${Number(asked.basePrice).toLocaleString("en-PH")}` : null;
    const orderLink = askedLink ?? shopLink;

    const productSummary = activeProducts
      .slice(0, 8)
      .map(
        (p) =>
          `- ${p.title}: ₱${Number(p.basePrice).toLocaleString("en-PH")}${p.compareAtPrice ? ` (was ₱${Number(p.compareAtPrice).toLocaleString("en-PH")})` : ""}`
      )
      .join("\n");

    const settings = tenant.settingsJson ?? {};
    const payments = resolveTenantPaymentsSettings(settings as Record<string, unknown>);
    const receiving = payments.receiving ?? {};
    const paymentLines = [
      settings.codEnabled !== false ? "COD available" : null,
      receiving.gcashNumber ? `GCash: ${receiving.gcashNumber}` : "GCash direct transfer (seller confirms)",
      receiving.mayaNumber ? `Maya: ${receiving.mayaNumber}` : null,
    ]
      .filter(Boolean)
      .join("; ");

    const generator = createAiGenerator();
    const result = await generator.generate({
      templateKey: "support_chatbot",
      userPrompt: `Customer question: ${body.message}

Shop: ${tenant.name}
Tagline: ${theme.tagline}
Products:
${productSummary || "- Ask seller for latest menu"}

Payment (MVP): ${paymentLines || "COD + direct GCash/Maya — seller confirms"}
Delivery: ${settings.delivery?.deliveryNotes || "Metro Manila / seller-defined area"}
${settings.minOrderAmount ? `Min order ₱${settings.minOrderAmount}` : ""}
${body.orderNumber ? `Customer order: ${body.orderNumber}` : ""}
${
  asked
    ? asked.available
      ? `The customer is asking about: ${asked.title}, ${askedPrice}${asked.variants.length > 1 ? " (starting price; has sizes/options)" : ""}. It is available. Say so, give that exact price, and end with this link for it: ${orderLink}`
      : `The customer is asking about: ${asked.title}. It is OUT OF STOCK right now. Say so politely and do not send an order link for it.`
    : ""
}

If they ask about paying via GCash/Maya, explain direct transfer to the shop number and that the seller confirms in-app. Suggest using Message seller to send the reference number.
Never confirm that a payment was received, never invent account numbers, and never promise delivery times you don't know.
Reply helpfully in ${assistant.tone}. Keep under 120 words. Include order link when relevant.
If the question needs a human (payment proof, order change, complaint), tell them to tap Message seller.`,
      subscriptionPlan: tenant.subscriptionPlan,
      taskType: "chat",
      tokensUsedThisMonth: quota.usage.tokensThisMonth,
      seller: {
        brandName: tenant.name,
        category: tenant.category ?? "General",
        location: "Philippines",
        tone: assistant.tone,
        audience: "Shop visitors / buyers awaiting payment confirmation",
        orderLink,
      },
    });

    const output = result.output as Record<string, unknown>;
    let reply =
      (typeof output.reply === "string" && output.reply) ||
      "Thanks for your message! Browse our products and tap Checkout when ready — or message the seller here about payment.";
    // The link must reach the buyer even if the model left it out.
    if (asked && askedLink && !reply.includes(askedLink)) {
      reply = `${reply.trim()}\n\n${asked.title} · ${askedPrice}\nOrder here: ${askedLink}`;
    }

    await saveShopChatMessage({
      tenantId,
      sessionId: body.sessionId,
      role: "assistant",
      content: reply,
    });

    await recordAiUsage(tenantId, { tokensUsed: result.tokensUsed });

    return NextResponse.json({ ok: true, reply, humanInbox: assistant.humanInbox });
  } catch (error) {
    console.error("Shop chat error:", error);
    return NextResponse.json({ ok: false, error: "Chat failed." }, { status: 400 });
  }
}
