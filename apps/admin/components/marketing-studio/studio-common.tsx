"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Camera, Check, Clapperboard, Copy, Download, Loader2, PenLine, Upload } from "lucide-react";
import { Card } from "@gumakart/ui";
import { productImageSrc } from "@/lib/product-image";

// ─── Types mirrored from GET /api/ai-media/jobs ────────────────────────────────

export interface StudioOutput {
  url: string;
  kind: "image" | "video" | "audio" | "other";
  contentType: string;
  variant?: string;
}
export interface StudioJob {
  id: string;
  jobType: "product_photo" | "video_ad" | "voice_clone" | "printair_mockup";
  status: "queued" | "processing" | "completed" | "failed";
  outputs: StudioOutput[];
  error: string | null;
  creditStatus: string;
  createdAt: string;
  input: { scene?: string; aspects?: string[]; productTitle?: string; durationSec?: number; voiceStyle?: string };
}
export interface Credit {
  limit: number;
  used: number;
  remaining: number | null;
}
export interface StudioState {
  tier: { id: string; name: string; grandfathered: boolean } | null;
  credits: { photo: Credit; video: Credit; voiceClone: boolean } | null;
  jobs: StudioJob[];
}

export interface ProductOption {
  id: string;
  title: string;
  basePrice: string;
  compareAtPrice: string | null;
  imageUrl: string | null;
}

// ─── Data hooks ───────────────────────────────────────────────────────────────

/** Loads credits + jobs; polls every 3 s while anything is queued or rendering (Workers can't push). */
export function useStudioJobs() {
  const [state, setState] = useState<StudioState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ai-media/jobs", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Couldn't load the studio.");
      setState({ tier: json.tier, credits: json.credits, jobs: json.jobs });
      setError(null);
      return json.jobs as StudioJob[];
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the studio.");
      return [];
    }
  }, []);

  const schedule = useCallback(
    (jobs: StudioJob[]) => {
      if (timer.current) clearTimeout(timer.current);
      if (jobs.some((j) => j.status === "queued" || j.status === "processing")) {
        timer.current = setTimeout(async () => schedule(await load()), 3000);
      }
    },
    [load]
  );

  const refresh = useCallback(async () => schedule(await load()), [load, schedule]);

  useEffect(() => {
    void refresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  return { state, error, refresh };
}

export function useProducts() {
  const [products, setProducts] = useState<ProductOption[]>([]);
  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((j) => (j.ok ? setProducts(j.products) : null))
      .catch(() => null);
  }, []);
  return products;
}

export async function postJson<T = Record<string, unknown>>(url: string, body: unknown, method = "POST"): Promise<T & { ok: boolean; error?: string; upgradeRequired?: boolean }> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

export async function uploadFile(endpoint: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(endpoint, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Upload failed.");
  return json.url as string;
}

export function idempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

// ─── Shell ────────────────────────────────────────────────────────────────────

const TABS = [
  { href: "/marketing-studio/photo", label: "Product photos", icon: Camera },
  { href: "/marketing-studio/video", label: "Video ads", icon: Clapperboard },
  { href: "/marketing-studio/copywriter", label: "Taglish copywriter", icon: PenLine },
];

export function StudioShell({ state, children }: { state: StudioState | null; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="marketing-studio">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-2" aria-label="Marketing Studio">
          {TABS.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${active ? "bg-violet-600 text-white" : "bg-white/5 text-muted-foreground hover:text-foreground"}`}
              >
                <t.icon className="h-4 w-4" /> {t.label}
              </Link>
            );
          })}
        </nav>
        {state?.credits ? <CreditMeter state={state} /> : null}
      </div>
      {children}
    </div>
  );
}

function fmt(c: Credit): string {
  if (c.limit === -1) return "Unlimited";
  if (c.limit === 0) return "—";
  return `${c.remaining ?? 0} / ${c.limit} left`;
}

function CreditMeter({ state }: { state: StudioState }) {
  const c = state.credits!;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" data-testid="credit-meter">
      {state.tier ? <span className="rounded-full bg-violet-600/15 px-2 py-0.5 font-medium text-violet-300">{state.tier.name}</span> : null}
      <span>Photos: <b className="text-foreground">{fmt(c.photo)}</b></span>
      <span>Videos: <b className="text-foreground">{fmt(c.video)}</b></span>
    </div>
  );
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

export function ProductPicker({ products, value, onChange, label = "Product (optional)" }: { products: ProductOption[]; value: string; onChange: (id: string) => void; label?: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2">
        <option value="">— None —</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ImageUploader({ value, onChange, label }: { value: string; onChange: (url: string) => void; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 p-4 text-center text-sm text-muted-foreground hover:border-violet-500/60">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={productImageSrc(value)} alt="" className="h-36 w-36 rounded-xl object-contain" />
        ) : busy ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : (
          <Upload className="h-6 w-6" />
        )}
        <span>{value ? "Change photo" : label}</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onDragOver={(e) => e.preventDefault()}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(null);
            try {
              onChange(await uploadFile("/api/products/upload", file));
            } catch (err) {
              setError(err instanceof Error ? err.message : "Upload failed.");
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  const cls = { info: "border-violet-500/30 bg-violet-500/10", warn: "border-amber-500/30 bg-amber-500/10", error: "border-red-500/30 bg-red-500/10 text-red-300", success: "border-emerald-500/30 bg-emerald-500/10" }[tone];
  return <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${cls}`}>{tone === "error" || tone === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : null}<div>{children}</div></div>;
}

export function UpgradeHint({ children }: { children: ReactNode }) {
  return (
    <Notice tone="warn">
      {children}{" "}
      <Link href="/settings/subscription" className="font-medium underline underline-offset-2">
        See plans
      </Link>
    </Notice>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => null);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {done ? "Copied" : label}
    </button>
  );
}

// ─── Gallery ──────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<StudioJob["status"], string> = {
  queued: "Waiting for the studio GPU…",
  processing: "Rendering…",
  completed: "Done",
  failed: "Failed — credit refunded",
};

export function JobGallery({ jobs, type, empty }: { jobs: StudioJob[]; type: StudioJob["jobType"][]; empty: string }) {
  const list = jobs.filter((j) => type.includes(j.jobType));
  if (!list.length) return <Card className="p-6 text-center text-sm text-muted-foreground">{empty}</Card>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2" data-testid="job-gallery">
      {list.map((j) => (
        <li key={j.id}>
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">{j.input.productTitle ?? (j.jobType === "voice_clone" ? "Voice preview" : "Untitled")}</span>
              <span className={`inline-flex items-center gap-1 ${j.status === "failed" ? "text-red-400" : j.status === "completed" ? "text-emerald-400" : "text-muted-foreground"}`}>
                {j.status === "queued" || j.status === "processing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {STATUS_LABEL[j.status]}
              </span>
            </div>
            {j.status === "failed" && j.error ? <p className="text-xs text-red-300/80">{j.error}</p> : null}
            {j.status === "queued" ? <p className="text-xs text-muted-foreground">If the studio is offline your job waits safely and starts when it's back — no credit is lost.</p> : null}
            <div className="grid grid-cols-2 gap-2">
              {j.outputs.filter((o) => o.variant !== "script").map((o) => (
                <OutputTile key={o.url} output={o} />
              ))}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function OutputTile({ output }: { output: StudioOutput }) {
  const full = output.kind === "video" ? "col-span-2" : "";
  return (
    <figure className={`space-y-1 ${full}`}>
      {output.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={output.url} alt={output.variant ?? "AI render"} className="w-full rounded-lg bg-black/20 object-contain" loading="lazy" />
      ) : output.kind === "video" ? (
        <video src={output.url} controls playsInline className="mx-auto max-h-96 rounded-lg bg-black" />
      ) : output.kind === "audio" ? (
        <audio src={output.url} controls className="w-full" />
      ) : null}
      <figcaption className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{output.variant ?? output.kind}</span>
        <a href={output.url} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
          <Download className="h-3 w-3" /> Download
        </a>
      </figcaption>
    </figure>
  );
}
