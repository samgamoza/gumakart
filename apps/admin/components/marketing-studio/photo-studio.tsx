"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Card } from "@gumakart/ui";
import { ASPECT_RATIOS, SCENE_PRESETS, type AspectRatio } from "@gumakart/ai/studio";
import { ImageUploader, JobGallery, Notice, ProductPicker, StudioShell, UpgradeHint, idempotencyKey, postJson, useProducts, useStudioJobs } from "./studio-common";

/** Phase 2.1 — 1-click studio product photography (Flux.1 Fill + RMBG-2.0 on the home GPU). */
export function PhotoStudio() {
  const { state, error, refresh } = useStudioJobs();
  const products = useProducts();
  const [productId, setProductId] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [scene, setScene] = useState<string>(SCENE_PRESETS[0].id);
  const [customPrompt, setCustomPrompt] = useState("");
  const [aspects, setAspects] = useState<AspectRatio[]>(["1:1"]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string; upgrade?: boolean } | null>(null);

  const photo = state?.credits?.photo;
  const noPhotos = photo?.limit === 0;
  const out = photo && photo.remaining !== null && photo.remaining <= 0 && photo.limit !== 0;

  function pickProduct(id: string) {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    if (p?.imageUrl && !imageUrl) setImageUrl(p.imageUrl);
  }

  function toggleAspect(a: AspectRatio) {
    setAspects((cur) => (cur.includes(a) ? (cur.length > 1 ? cur.filter((x) => x !== a) : cur) : [...cur, a]));
  }

  async function submit() {
    setBusy(true);
    setMessage(null);
    const res = await postJson("/api/ai-media/jobs", {
      jobType: "product_photo",
      productId: productId || undefined,
      idempotencyKey: idempotencyKey(),
      payload: { sourceImageUrl: imageUrl, scene, customPrompt: scene === "custom" ? customPrompt : undefined, aspects },
    }).catch(() => ({ ok: false, error: "Network error." }) as { ok: false; error: string; upgradeRequired?: boolean });
    setBusy(false);
    if (!res.ok) return setMessage({ tone: "error", text: res.error ?? "Couldn't start.", upgrade: res.upgradeRequired });
    setMessage({ tone: "success", text: "Rendering on the studio GPU — your photos appear below in a minute or two. 1 credit used (refunded if it fails)." });
    void refresh();
  }

  return (
    <StudioShell state={state}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {noPhotos ? <UpgradeHint>AI product photos start on the Starter plan (20 a month).</UpgradeHint> : null}
      <Card className="grid gap-5 p-5 md:grid-cols-[220px_1fr]">
        <div className="space-y-3">
          <ProductPicker products={products} value={productId} onChange={pickProduct} />
          <ImageUploader value={imageUrl} onChange={setImageUrl} label="Drop or choose a raw product photo" />
          <p className="text-xs text-muted-foreground">Plain photos work best: the whole product in frame, any background. Your product stays exactly as it is — only the scene around it is generated.</p>
        </div>
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Scene</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[...SCENE_PRESETS.map((p) => ({ id: p.id as string, label: p.label })), { id: "custom", label: "Custom scene…" }].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setScene(p.id)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm ${scene === p.id ? "border-violet-500 bg-violet-500/10" : "border-white/10 hover:border-white/25"}`}
                  aria-pressed={scene === p.id}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {scene === "custom" ? (
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                maxLength={300}
                rows={2}
                placeholder="e.g. on a marble bathroom counter with soft morning light and eucalyptus leaves"
                className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm"
              />
            ) : null}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Size</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ASPECT_RATIOS) as AspectRatio[]).map((a) => (
                <label key={a} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${aspects.includes(a) ? "border-violet-500 bg-violet-500/10" : "border-white/10"}`}>
                  <input type="checkbox" checked={aspects.includes(a)} onChange={() => toggleAspect(a)} className="accent-violet-600" />
                  {ASPECT_RATIOS[a].label} <span className="text-xs text-muted-foreground">{ASPECT_RATIOS[a].width}×{ASPECT_RATIOS[a].height}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !imageUrl || noPhotos || !!out || (scene === "custom" && customPrompt.trim().length < 8)}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate studio photo · 1 credit
          </button>
          {out ? <Notice tone="warn">You've used this month's photo credits. They reset on the 1st.</Notice> : null}
          {message ? (message.upgrade ? <UpgradeHint>{message.text}</UpgradeHint> : <Notice tone={message.tone}>{message.text}</Notice>) : null}
        </div>
      </Card>
      <h2 className="pt-2 text-sm font-semibold">Your studio photos</h2>
      <JobGallery jobs={state?.jobs ?? []} type={["product_photo"]} empty="No photos yet — upload a product photo and pick a scene." />
    </StudioShell>
  );
}
