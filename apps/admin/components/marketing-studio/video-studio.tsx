"use client";

import { useState } from "react";
import { Clapperboard, Loader2, Mic } from "lucide-react";
import { Card } from "@gumakart/ui";
import { VIDEO_DURATIONS, VOICE_STYLES } from "@gumakart/ai/studio";
import { ImageUploader, JobGallery, Notice, ProductPicker, StudioShell, UpgradeHint, idempotencyKey, postJson, uploadFile, useProducts, useStudioJobs } from "./studio-common";

const PAYMENTS = [
  { id: "cod", label: "COD" },
  { id: "gcash", label: "GCash" },
  { id: "maya", label: "Maya" },
  { id: "qrph", label: "QRPh" },
] as const;

/** Phase 2.2 — 15/30 s vertical video ads: Qwen3 script → F5-TTS voice → Wan 2.1 clips → FFmpeg. */
export function VideoStudio() {
  const { state, error, refresh } = useStudioJobs();
  const products = useProducts();
  const [productId, setProductId] = useState("");
  const [title, setTitle] = useState("");
  const [images, setImages] = useState<string[]>(["", "", ""]);
  const [price, setPrice] = useState("");
  const [promoPrice, setPromoPrice] = useState("");
  const [discountLabel, setDiscountLabel] = useState("");
  const [stockLeft, setStockLeft] = useState("");
  const [freeShipping, setFreeShipping] = useState(false);
  const [payments, setPayments] = useState<string[]>(["cod", "gcash"]);
  const [voiceStyle, setVoiceStyle] = useState<string>("energetic_filipina");
  const [sampleUrl, setSampleUrl] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [sampleBusy, setSampleBusy] = useState(false);
  const [duration, setDuration] = useState<15 | 30>(15);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string; upgrade?: boolean } | null>(null);

  const video = state?.credits?.video;
  const gated = video?.limit === 0;
  const canClone = !!state?.credits?.voiceClone;

  function pickProduct(id: string) {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    if (!p) return;
    setTitle(p.title);
    const base = Number(p.basePrice);
    const compare = p.compareAtPrice ? Number(p.compareAtPrice) : null;
    if (compare && compare > base) {
      setPrice(String(compare));
      setPromoPrice(String(base));
    } else {
      setPrice(String(base || ""));
      setPromoPrice("");
    }
    if (p.imageUrl && !images[0]) setImages([p.imageUrl, images[1]!, images[2]!]);
  }

  async function submit() {
    setBusy(true);
    setMessage(null);
    const res = await postJson("/api/ai-media/jobs", {
      jobType: "video_ad",
      productId: productId || undefined,
      idempotencyKey: idempotencyKey(),
      payload: {
        imageUrls: images.filter(Boolean),
        productTitle: title,
        price: Number(price),
        promoPrice: promoPrice ? Number(promoPrice) : undefined,
        discountLabel: discountLabel || undefined,
        stockLeft: stockLeft ? Number(stockLeft) : undefined,
        freeShipping,
        paymentMethods: payments,
        voiceStyle,
        voiceSampleUrl: voiceStyle === "custom" ? sampleUrl : undefined,
        voiceSampleText: voiceStyle === "custom" ? sampleText : undefined,
        durationSec: duration,
      },
    }).catch(() => ({ ok: false, error: "Network error." }) as { ok: false; error: string; upgradeRequired?: boolean });
    setBusy(false);
    if (!res.ok) return setMessage({ tone: "error", text: res.error ?? "Couldn't start.", upgrade: res.upgradeRequired });
    setMessage({ tone: "success", text: "Your ad is in the studio queue. Videos take a few minutes — this page updates by itself. 1 video credit used (refunded if it fails)." });
    void refresh();
  }

  const ready = images.some(Boolean) && title.trim().length >= 2 && Number(price) > 0 && payments.length > 0 && (voiceStyle !== "custom" || (sampleUrl && sampleText.trim().length >= 10));

  return (
    <StudioShell state={state}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {gated ? <UpgradeHint>AI video ads are on Pro Live (10 a month) and Enterprise Vibe (40 a month).</UpgradeHint> : null}
      <Card className="space-y-5 p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <ProductPicker products={products} value={productId} onChange={pickProduct} />
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">What you're selling</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Price (₱)</span>
                <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Promo price (₱, optional)</span>
                <input inputMode="decimal" value={promoPrice} onChange={(e) => setPromoPrice(e.target.value.replace(/[^\d.]/g, ""))} className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Promo label (optional)</span>
                <input value={discountLabel} onChange={(e) => setDiscountLabel(e.target.value)} maxLength={40} placeholder="e.g. Payday Sale" className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Stock left (optional)</span>
                <input inputMode="numeric" value={stockLeft} onChange={(e) => setStockLeft(e.target.value.replace(/\D/g, ""))} placeholder="real number only" className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2" />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">The ad only says what's true: stock counts and free shipping are mentioned only if you fill them in.</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={freeShipping} onChange={(e) => setFreeShipping(e.target.checked)} className="accent-violet-600" /> I offer free shipping (via BayanGo)
            </label>
            <div className="flex flex-wrap gap-2 text-sm">
              {PAYMENTS.map((p) => (
                <label key={p.id} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 ${payments.includes(p.id) ? "border-violet-500 bg-violet-500/10" : "border-white/10"}`}>
                  <input type="checkbox" checked={payments.includes(p.id)} onChange={() => setPayments((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id]))} className="accent-violet-600" />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium">1–3 photos (one per scene: hook, body, call-to-action)</p>
            <div className="grid grid-cols-3 gap-2">
              {images.map((url, i) => (
                <ImageUploader key={i} value={url} onChange={(u) => setImages((cur) => cur.map((x, j) => (j === i ? u : x)))} label={`Scene ${i + 1}`} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Tip: use your AI studio photos from the Product photos tab for the best results.</p>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Voice</legend>
          <div className="flex flex-wrap gap-2">
            {VOICE_STYLES.map((v) => {
              const locked = v.enterpriseOnly && !canClone;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={locked}
                  onClick={() => setVoiceStyle(v.id)}
                  aria-pressed={voiceStyle === v.id}
                  className={`rounded-xl border px-3 py-2 text-sm disabled:opacity-40 ${voiceStyle === v.id ? "border-violet-500 bg-violet-500/10" : "border-white/10"}`}
                  title={locked ? "Enterprise Vibe" : undefined}
                >
                  {v.label}
                  {locked ? " · Enterprise Vibe" : ""}
                </button>
              );
            })}
          </div>
          {voiceStyle === "custom" ? (
            <div className="space-y-2 rounded-xl border border-white/10 p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                {sampleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                {sampleUrl ? "Recording uploaded — change" : "Upload a clear ~10-second recording of your voice"}
                <input
                  type="file"
                  accept="audio/*"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setSampleBusy(true);
                    try {
                      setSampleUrl(await uploadFile("/api/ai-media/voice-sample", f));
                    } catch (err) {
                      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Upload failed." });
                    } finally {
                      setSampleBusy(false);
                    }
                  }}
                />
              </label>
              <textarea
                value={sampleText}
                onChange={(e) => setSampleText(e.target.value)}
                rows={2}
                maxLength={600}
                placeholder="Type exactly what you say in the recording (needed to clone the voice)"
                className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm"
              />
            </div>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          {VIDEO_DURATIONS.map((d) => (
            <button key={d} type="button" onClick={() => setDuration(d)} aria-pressed={duration === d} className={`rounded-xl border px-3 py-2 text-sm ${duration === d ? "border-violet-500 bg-violet-500/10" : "border-white/10"}`}>
              {d} seconds
            </button>
          ))}
          <button type="button" onClick={submit} disabled={busy || !ready || gated} className="ml-auto inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />} Create video ad · 1 credit
          </button>
        </div>
        {message ? (message.upgrade ? <UpgradeHint>{message.text}</UpgradeHint> : <Notice tone={message.tone}>{message.text}</Notice>) : null}
      </Card>
      <h2 className="pt-2 text-sm font-semibold">Your video ads</h2>
      <JobGallery jobs={state?.jobs ?? []} type={["video_ad", "voice_clone"]} empty="No videos yet. Each ad ends with your shop link and QR code." />
    </StudioShell>
  );
}
