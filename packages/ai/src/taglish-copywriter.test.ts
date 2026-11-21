import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { productPhotoPayloadSchema, videoAdPayloadSchema, formatPeso } from "./studio-presets";
import { buildCopywriterMessages, copywriterInputSchema, mockCopywriter, normalizeHashtags, parseCopywriterOutput, runTaglishCopywriter, scrubCopyClaims } from "./taglish-copywriter";

const input = copywriterInputSchema.parse({
  shopName: "Simply Sweet",
  productTitle: "Ube Cheese Pandesal (12 pcs)",
  price: 280,
  promoPrice: 240,
  link: "https://kart.guma.one/simply-sweet/products/ube-pandesal",
  platform: "facebook",
});

describe("Taglish copywriter", () => {
  it("prompt: PH psychology + honest-claims rules + only real facts", () => {
    const { system, user } = buildCopywriterMessages(input);
    assert.match(system, /Taglish/);
    assert.match(system, /Never invent stock counts/);
    assert.match(system, /#TikTokFindsPH/);
    assert.match(user, /₱240 \(regular ₱280\)/);
    assert.match(user, /Payment: COD, GCash/);
    assert.ok(!/Stock left|Free shipping/.test(user));
  });

  it("parses model JSON, scrubs invented claims, keeps the link and normalises hashtags", () => {
    const raw = JSON.stringify({
      hooks: ["Last 15 slots na lang!", "500+ sold na!", "Ube lovers, ito na!"],
      caption: "Ube cheese pandesal ₱240 lang! FREE SHIPPING pa! 1000 sold na! Order na!",
      hashtags: ["TikTokFindsPH", "#Budol Finds", "#ube#pandesal", "#TikTokFindsPH"],
      commentKeyword: "mine!",
      publicReplies: ["Sent you a DM po!"],
    });
    const out = parseCopywriterOutput(raw, input)!;
    assert.ok(!/15 slots/.test(out.hooks[0]!) && /habang may stock pa/.test(out.hooks[0]!));
    assert.ok(!/sold/i.test(out.hooks[1]! + out.caption));
    assert.ok(!/free shipping/i.test(out.caption));
    assert.ok(out.caption.includes(input.link), "link appended");
    assert.deepEqual(out.hashtags, ["#TikTokFindsPH", "#Budol", "#Finds", "#ube", "#pandesal", "#SupportLocalPH"]);
    assert.equal(out.commentKeyword, "MINE");
    assert.equal(parseCopywriterOutput("Sorry, I can't", input), null);
  });

  it("real stock and free shipping survive", () => {
    const real = copywriterInputSchema.parse({ ...input, stockLeft: 6, freeShipping: true });
    assert.equal(scrubCopyClaims("6 pcs na lang! Free shipping!", real), "6 pcs na lang! Free shipping!");
    assert.equal(normalizeHashtags([]).includes("#SupportLocalPH"), true);
    assert.match(mockCopywriter(real).caption, /Free shipping via BayanGo/);
  });

  it("local Qwen3 first; cloud/mock when the tunnel is down", async () => {
    const good = JSON.stringify({ hooks: ["Ube lovers!"], caption: "Ube pandesal ₱240 lang!", hashtags: ["#ube"], commentKeyword: "MINE" });
    const bridge = (status: number) => ({
      url: "https://bridge.example",
      secret: "x".repeat(40),
      timeoutMs: 1000,
      fetch: (async () =>
        status === 200
          ? Response.json({ ok: true, content: good, model: "qwen3-235b", usage: { promptTokens: 100, completionTokens: 50 }, toolCalls: [], finishReason: "stop" })
          : new Response("tunnel down", { status })) as typeof fetch,
    });
    const local = await runTaglishCopywriter(input, { tenantId: "t", bridge: bridge(200) });
    assert.deepEqual([local.servedBy, local.model, local.tokensUsed], ["gpu-node", "qwen3-235b", 150]);
    const reasons: string[] = [];
    const fallback = await runTaglishCopywriter(input, { tenantId: "t", bridge: bridge(530), onFallback: (r) => reasons.push(r) });
    assert.notEqual(fallback.servedBy, "gpu-node");
    assert.deepEqual(reasons, ["unavailable"]);
    assert.ok(fallback.output.caption.includes(input.link));
  });
});

describe("Marketing Studio payload contracts", () => {
  it("product photo: preset or a described custom scene, 1–2 aspects", () => {
    assert.ok(productPhotoPayloadSchema.safeParse({ sourceImageUrl: "/uploads/products/t/a.png", scene: "tropical_boracay_beach", aspects: ["1:1", "9:16"] }).success);
    assert.ok(!productPhotoPayloadSchema.safeParse({ sourceImageUrl: "/a.png", scene: "custom", aspects: ["1:1"] }).success);
    assert.ok(!productPhotoPayloadSchema.safeParse({ sourceImageUrl: "/a.png", scene: "studio", aspects: [] }).success);
  });
  it("video ad: custom voice needs a sample + transcript; promo below price", () => {
    const base = { imageUrls: ["/a.png"], productTitle: "Tumbler", price: 599, voiceStyle: "casual_kuya", durationSec: 15, shopName: "S", storeUrl: "https://kart.guma.one/s" };
    assert.ok(videoAdPayloadSchema.safeParse(base).success);
    assert.ok(!videoAdPayloadSchema.safeParse({ ...base, voiceStyle: "custom" }).success);
    assert.ok(videoAdPayloadSchema.safeParse({ ...base, voiceStyle: "custom", voiceSampleUrl: "/v.wav", voiceSampleText: "Hello po ito ako" }).success);
    assert.ok(!videoAdPayloadSchema.safeParse({ ...base, promoPrice: 700 }).success);
    assert.ok(!videoAdPayloadSchema.safeParse({ ...base, durationSec: 20 }).success);
    assert.equal(formatPeso(1299), "₱1,299");
    assert.equal(formatPeso(99.5), "₱99.50");
  });
});
