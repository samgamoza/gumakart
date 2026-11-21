"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Loader2, MessageSquareReply, PenLine, Save } from "lucide-react";
import { Card } from "@gumakart/ui";
import { CopyButton, Notice, ProductPicker, StudioShell, UpgradeHint, postJson, useProducts, useStudioJobs } from "./studio-common";

interface Copy {
  hooks: string[];
  caption: string;
  cta: string;
  hashtags: string[];
  commentKeyword: string;
  publicReplies: string[];
  trustBadges: string[];
}
interface StudioPost {
  id: string;
  platform: string;
  title: string | null;
  status: string;
  createdAt: string;
  trigger: { keywords: string[]; postId: string | null; postUrl: string | null } | null;
}

const PLATFORMS = [
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
] as const;
const ANGLES = [
  { id: "auto", label: "Best angle" },
  { id: "urgency", label: "Urgency" },
  { id: "payday", label: "Payday treat" },
  { id: "bundle", label: "Bundle / barkada" },
  { id: "new_arrival", label: "New arrival" },
  { id: "restock", label: "Restocked" },
] as const;

/** Phase 2.3 — Taglish viral copy & hooks (local Qwen3, cloud fallback) + Save to Post & Attach Comment-to-DM Trigger. */
export function CopywriterStudio() {
  const { state } = useStudioJobs();
  const products = useProducts();
  const [productId, setProductId] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]["id"]>("facebook");
  const [angle, setAngle] = useState<(typeof ANGLES)[number]["id"]>("auto");
  const [stockLeft, setStockLeft] = useState("");
  const [freeShipping, setFreeShipping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; upgrade?: boolean } | null>(null);
  const [copy, setCopy] = useState<Copy | null>(null);
  const [link, setLink] = useState("");
  const [hookIdx, setHookIdx] = useState(0);
  const [caption, setCaption] = useState("");
  const [keywords, setKeywords] = useState("");
  const [media, setMedia] = useState<string[]>([]);
  const [attach, setAttach] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [posts, setPosts] = useState<StudioPost[]>([]);

  const freePlan = state?.tier?.id === "free";
  const studioImages = (state?.jobs ?? []).filter((j) => j.status === "completed").flatMap((j) => j.outputs.filter((o) => (o.kind === "image" && o.variant !== "thumbnail") || o.kind === "video"));

  const loadPosts = useCallback(async () => {
    const r = await fetch("/api/ai/copywriter/posts", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) setPosts(r.posts);
  }, []);
  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  async function generate() {
    setBusy(true);
    setError(null);
    setSaved(null);
    const res = await postJson<{ copy: Copy; link: string; servedBy: string }>("/api/ai/copywriter", {
      productId: productId || undefined,
      productTitle: productId ? undefined : title,
      price: price ? Number(price) : undefined,
      platform,
      angle,
      stockLeft: stockLeft ? Number(stockLeft) : null,
      freeShipping,
    }).catch(() => ({ ok: false, error: "Network error." }) as never);
    setBusy(false);
    if (!res.ok) return setError({ text: res.error ?? "Couldn't write the copy.", upgrade: res.upgradeRequired });
    setCopy(res.copy);
    setLink(res.link);
    setHookIdx(0);
    setCaption(res.copy.caption);
    setKeywords(["HM", "MINE", "Available pa?", "Details", "Magkano", res.copy.commentKeyword].filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i).join(", "));
  }

  async function save() {
    if (!copy) return;
    setSaving(true);
    setError(null);
    const res = await postJson<{ triggerAttached: boolean; notice?: string }>("/api/ai/copywriter/save", {
      platform,
      productId: productId || undefined,
      link,
      hook: copy.hooks[hookIdx],
      caption,
      hashtags: copy.hashtags,
      mediaUrls: media,
      attachTrigger: attach,
      triggerKeywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
      publicReplies: copy.publicReplies,
      copy,
    }).catch(() => ({ ok: false, error: "Network error." }) as never);
    setSaving(false);
    if (!res.ok) return setError({ text: res.error ?? "Couldn't save." });
    setSaved(res.notice ?? (res.triggerAttached ? "Saved! Post it on your page, then paste the post link below to switch on auto-DMs." : "Saved to your posts."));
    void loadPosts();
  }

  const fullText = copy ? `${copy.hooks[hookIdx]}\n\n${caption}\n\n${copy.hashtags.join(" ")}` : "";

  return (
    <StudioShell state={state}>
      <Card className="grid gap-4 p-5 md:grid-cols-2">
        <div className="space-y-3">
          <ProductPicker products={products} value={productId} onChange={setProductId} />
          {!productId ? (
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Or type what you're selling" className="rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm" />
              <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder="₱ price" inputMode="decimal" className="rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm" />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button key={p.id} type="button" onClick={() => setPlatform(p.id)} aria-pressed={platform === p.id} className={`rounded-full px-3 py-1.5 text-sm ${platform === p.id ? "bg-violet-600 text-white" : "bg-white/5 text-muted-foreground"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <select value={angle} onChange={(e) => setAngle(e.target.value as typeof angle)} className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm">
            {ANGLES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <input value={stockLeft} onChange={(e) => setStockLeft(e.target.value.replace(/\D/g, ""))} placeholder="Stock left (optional)" inputMode="numeric" className="w-44 rounded-xl border border-white/10 bg-transparent px-3 py-2" />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={freeShipping} onChange={(e) => setFreeShipping(e.target.checked)} className="accent-violet-600" /> Free shipping
            </label>
          </div>
          <button type="button" onClick={generate} disabled={busy || (!productId && title.trim().length < 2)} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Write viral copy
          </button>
          <p className="text-xs text-muted-foreground">Uses 1 AI generation. Only real facts — no made-up "sold" counts or fake scarcity.</p>
          {error ? error.upgrade ? <UpgradeHint>{error.text}</UpgradeHint> : <Notice tone="error">{error.text}</Notice> : null}
        </div>

        <div className="space-y-3">
          {copy ? (
            <>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Pick a hook</p>
                {copy.hooks.map((h, i) => (
                  <button key={i} type="button" onClick={() => setHookIdx(i)} aria-pressed={hookIdx === i} className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${hookIdx === i ? "border-violet-500 bg-violet-500/10" : "border-white/10"}`}>
                    {h}
                  </button>
                ))}
              </div>
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={7} className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm" />
              <p className="text-xs text-violet-300">{copy.hashtags.join(" ")}</p>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={fullText} label="Copy post" />
                {copy.trustBadges.map((b) => (
                  <span key={b} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">{b}</span>
                ))}
              </div>
              {studioImages.length ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Attach studio media</p>
                  <div className="flex flex-wrap gap-2">
                    {studioImages.slice(0, 8).map((o) => (
                      <button key={o.url} type="button" onClick={() => setMedia((m) => (m.includes(o.url) ? m.filter((x) => x !== o.url) : [...m, o.url]))} className={`overflow-hidden rounded-lg border-2 ${media.includes(o.url) ? "border-violet-500" : "border-transparent"}`}>
                        {o.kind === "video" ? <span className="flex h-14 w-14 items-center justify-center bg-black text-[10px]">VIDEO</span> : <img src={o.url} alt="" className="h-14 w-14 object-cover" />}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="space-y-2 rounded-xl border border-white/10 p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={attach && !freePlan} disabled={freePlan} onChange={(e) => setAttach(e.target.checked)} className="accent-violet-600" />
                  <MessageSquareReply className="h-4 w-4" /> Attach comment-to-DM trigger
                </label>
                {freePlan ? <p className="text-xs text-muted-foreground">Auto-DMs on comments start on the Starter plan.</p> : (
                  <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className="w-full rounded-lg border border-white/10 bg-transparent px-2 py-1.5 text-xs" aria-label="Trigger keywords, comma separated" />
                )}
              </div>
              <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save to Post{attach && !freePlan ? " & Attach Comment-to-DM Trigger" : ""}
              </button>
              {saved ? <Notice tone="success">{saved}</Notice> : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Your hooks, caption, hashtags and auto-reply lines will appear here.</p>
          )}
        </div>
      </Card>

      <h2 className="pt-2 text-sm font-semibold">Saved posts</h2>
      {posts.length ? (
        <ul className="space-y-2">
          {posts.map((p) => (
            <PostRow key={p.id} post={p} onChanged={loadPosts} />
          ))}
        </ul>
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground">Nothing saved yet.</Card>
      )}
    </StudioShell>
  );
}

function PostRow({ post, onChanged }: { post: StudioPost; onChanged: () => void }) {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pending = post.trigger && !post.trigger.postId;
  return (
    <li>
      <Card className="space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium">{post.title ?? "Post"}</span>
          <span className="text-xs text-muted-foreground">
            {post.platform} · {post.trigger ? (pending ? "auto-DM waiting for the post link" : `auto-DM on (${post.trigger.keywords.slice(0, 3).join(", ")}…)`) : "no trigger"}
          </span>
        </div>
        {pending ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Paste the published post link" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-transparent px-2 py-1.5 text-xs" />
            <button
              type="button"
              disabled={busy || ref.trim().length < 3}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                const r = await postJson(`/api/ai/copywriter/posts/${post.id}`, { postRef: ref }, "PATCH").catch(() => ({ ok: false, error: "Network error." }));
                setBusy(false);
                if (!r.ok) return setErr(r.error ?? "Couldn't attach.");
                onChanged();
              }}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Switch on auto-DM"}
            </button>
            {err ? <p className="w-full text-xs text-red-400">{err}</p> : null}
          </div>
        ) : null}
      </Card>
    </li>
  );
}
