"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2 } from "lucide-react";
import { formatPrice } from "@gumakart/ui";
import { AuthError, AuthField, AuthLayout, authInputClassName } from "@/components/auth-layout";
import { QrModal, SharePanelBody, type CheckoutLink } from "@/components/checkout-links-manager";
import { productImageSrc } from "@/lib/product-image";

/**
 * Plan §9 — steps 2–4 after "Your business" (step 1 is part of signup):
 *   2 First product   3 How you get paid   4 Your checkout link is ready
 * Every step can be left for later; the dashboard is always one tap away.
 */

type Step = "product" | "payments" | "link" | "done";

interface State {
  step: Step;
  shop: { name: string; slug: string };
  sellChannels: string[];
  chatUrl: string | null;
  products: Array<{ id: string; title: string; price: string; imageUrl: string | null; stockQty: number }>;
  payments: { gcashNumber: string; gcashName: string; mayaNumber: string; mayaName: string; codEnabled: boolean };
}

const STEP_NUMBER: Record<Exclude<Step, "done">, number> = { product: 2, payments: 3, link: 4 };
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const primaryBtn =
  "flex h-11 w-full items-center justify-center gap-2 rounded-xl gradient-accent text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60";

function Progress({ step }: { step: Exclude<Step, "done"> }) {
  const n = STEP_NUMBER[step];
  return (
    <div className="mb-6 flex gap-2" aria-hidden>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= n ? "bg-emerald-500" : "bg-white/10"}`} />
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [linkBase, setLinkBase] = useState("");
  const [pickupEnabled, setPickupEnabled] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/onboarding/state", { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error ?? "Couldn't load your shop.");
      return;
    }
    setState(data.state);
    setLinkBase(data.linkBaseUrl);
    setPickupEnabled(Boolean(data.pickupEnabled));
    setStep((current) => current ?? data.state.step);
    setProductId((current) => current ?? data.state.products[0]?.id ?? null);
    if (data.state.step === "done") router.replace("/");
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function later() {
    await fetch("/api/onboarding/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "skipped" }),
    }).catch(() => undefined);
    router.push("/");
    router.refresh();
  }

  if (!state || !step || step === "done") {
    return (
      <AuthLayout title="Setting up your shop" subtitle="One moment…">
        {error ? <AuthError message={error} /> : <p className="text-center text-sm text-slate-400">Loading…</p>}
      </AuthLayout>
    );
  }

  const laterLink = (
    <button type="button" onClick={() => void later()} className="mt-5 w-full text-center text-xs text-slate-400 hover:text-white">
      I&apos;ll finish this later
    </button>
  );

  if (step === "product") {
    return (
      <AuthLayout title="Your first product" subtitle="Step 2 of 4 · What do you want to sell first?">
        <Progress step="product" />
        <ProductStep
          existing={state.products}
          onDone={(id) => {
            setProductId(id);
            setStep("payments");
          }}
        />
        {laterLink}
      </AuthLayout>
    );
  }

  if (step === "payments") {
    return (
      <AuthLayout title="How you get paid" subtitle="Step 3 of 4 · Buyers pay you directly. Guma never holds your money.">
        <Progress step="payments" />
        <PaymentsStep initial={state.payments} onDone={() => setStep("link")} />
        {laterLink}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Your checkout link is ready" subtitle="Step 4 of 4 · Share it where your buyers already are">
      <Progress step="link" />
      <LinkStep
        productId={productId}
        sellChannels={state.sellChannels}
        pickupEnabled={pickupEnabled}
        linkBase={linkBase}
        onBack={() => setStep("product")}
        onFinish={async () => {
          await fetch("/api/onboarding/finish", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "completed" }),
          }).catch(() => undefined);
          router.push("/");
          router.refresh();
        }}
      />
    </AuthLayout>
  );
}

// ─── Step 2: first product ───────────────────────────────────────────────────

function ProductStep({
  existing,
  onDone,
}: {
  existing: State["products"];
  onDone: (productId: string) => void;
}) {
  const [mode, setMode] = useState<"new" | "existing">(existing.length > 0 ? "existing" : "new");
  const [pick, setPick] = useState<string | null>(existing[0]?.id ?? null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("10");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (!IMAGE_TYPES.includes(file.type)) return setError("Use a JPG, PNG or WebP photo.");
    if (file.size > MAX_IMAGE_BYTES) return setError("The photo must be 5 MB or smaller.");
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/products/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't upload the photo.");
      setImageUrl(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't upload the photo.");
    } finally {
      setUploading(false);
    }
  }

  async function markDone(id: string) {
    await fetch("/api/onboarding/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "product_done" }),
    }).catch(() => undefined);
    onDone(id);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (mode === "existing") {
      if (!pick) return setError("Pick a product.");
      return void markDone(pick);
    }
    const amount = Number(price.replace(/[^\d.]/g, ""));
    if (title.trim().length < 2) return setError("Enter the product name.");
    if (!(amount > 0)) return setError("Enter the price.");
    setSaving(true);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          basePrice: Math.round(amount * 100) / 100,
          stockQty: Math.max(0, Math.min(99999, Number(stock) || 0)),
          imageUrl: imageUrl ?? undefined,
          status: "active",
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't save the product.");
      await markDone(data.product.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the product.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <AuthError message={error} />

      {existing.length > 0 && (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 p-1 text-sm">
          {(["existing", "new"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-lg py-2 font-medium ${mode === m ? "bg-white/10 text-white" : "text-slate-400"}`}
            >
              {m === "existing" ? "Use one I have" : "Add a new one"}
            </button>
          ))}
        </div>
      )}

      {mode === "existing" ? (
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {existing.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPick(p.id)}
              className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left ${
                pick === p.id ? "border-emerald-400/60 bg-emerald-400/10" : "border-white/10"
              }`}
            >
              <span className="h-11 w-11 flex-none overflow-hidden rounded-lg bg-white/5">
                {p.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={productImageSrc(p.imageUrl)} alt="" className="h-full w-full object-cover" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">{p.title}</span>
                <span className="block text-xs text-slate-400">{formatPrice(Number(p.price))}</span>
              </span>
              {pick === p.id && <Check className="h-4 w-4 text-emerald-300" />}
            </button>
          ))}
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/20 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]"
          >
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={productImageSrc(imageUrl)} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex flex-col items-center gap-1.5 text-sm">
                <Camera className="h-7 w-7" />
                Add a photo
                <span className="text-xs text-slate-500">A clear phone photo is fine</span>
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
          <AuthField label="Product name" id="pname">
            <input id="pname" value={title} onChange={(e) => setTitle(e.target.value)} className={authInputClassName} placeholder="e.g. Ube Halaya 500g" />
          </AuthField>
          <div className="grid grid-cols-2 gap-3">
            <AuthField label="Price (₱)" id="pprice">
              <input id="pprice" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={authInputClassName} placeholder="250" />
            </AuthField>
            <AuthField label="How many in stock" id="pstock">
              <input id="pstock" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, ""))} className={authInputClassName} />
            </AuthField>
          </div>
        </>
      )}

      <button type="submit" disabled={saving || uploading} className={primaryBtn}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Continue
      </button>
    </form>
  );
}

// ─── Step 3: payments ────────────────────────────────────────────────────────

function PaymentsStep({ initial, onDone }: { initial: State["payments"]; onDone: () => void }) {
  const [gcashNumber, setGcashNumber] = useState(initial.gcashNumber);
  const [gcashName, setGcashName] = useState(initial.gcashName);
  const [showMaya, setShowMaya] = useState(Boolean(initial.mayaNumber));
  const [mayaNumber, setMayaNumber] = useState(initial.mayaNumber);
  const [mayaName, setMayaName] = useState(initial.mayaName);
  const [cod, setCod] = useState(initial.codEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gcashNumber: gcashNumber.trim() || undefined,
          gcashName: gcashName.trim() || undefined,
          mayaNumber: showMaya ? mayaNumber.trim() || undefined : undefined,
          mayaName: showMaya ? mayaName.trim() || undefined : undefined,
          codEnabled: cod,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't save.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <AuthError message={error} />
      <div className="rounded-xl border border-white/10 p-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#007dfe] text-xs font-black">G</span> GCash
        </p>
        <div className="mt-3 grid gap-3">
          <input value={gcashNumber} onChange={(e) => setGcashNumber(e.target.value)} inputMode="tel" className={authInputClassName} placeholder="GCash number, e.g. 0917 123 4567" aria-label="GCash number" />
          <input value={gcashName} onChange={(e) => setGcashName(e.target.value)} className={authInputClassName} placeholder="Account name, e.g. Maria S." aria-label="GCash account name" />
        </div>
      </div>

      {showMaya ? (
        <div className="rounded-xl border border-white/10 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#00b86b] text-xs font-black">M</span> Maya
          </p>
          <div className="mt-3 grid gap-3">
            <input value={mayaNumber} onChange={(e) => setMayaNumber(e.target.value)} inputMode="tel" className={authInputClassName} placeholder="Maya number" aria-label="Maya number" />
            <input value={mayaName} onChange={(e) => setMayaName(e.target.value)} className={authInputClassName} placeholder="Account name" aria-label="Maya account name" />
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setShowMaya(true)} className="text-sm font-medium text-emerald-300 hover:underline">
          + Add Maya too
        </button>
      )}

      <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3">
        <span>
          <span className="block text-sm font-semibold text-white">Cash on delivery</span>
          <span className="block text-xs text-slate-400">Buyer pays the rider or pays at pickup</span>
        </span>
        <input type="checkbox" checked={cod} onChange={(e) => setCod(e.target.checked)} className="h-5 w-5 accent-emerald-500" />
      </label>

      <p className="text-xs text-slate-400">
        Buyers send money straight to your GCash or Maya and upload the receipt. You confirm it in Orders.
      </p>

      <button type="submit" disabled={saving} className={primaryBtn}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Continue
      </button>
    </form>
  );
}

// ─── Step 4: the link ────────────────────────────────────────────────────────

function LinkStep({
  productId,
  sellChannels,
  pickupEnabled,
  linkBase,
  onBack,
  onFinish,
}: {
  productId: string | null;
  sellChannels: string[];
  pickupEnabled: boolean;
  linkBase: string;
  onBack: () => void;
  onFinish: () => Promise<void>;
}) {
  const [link, setLink] = useState<CheckoutLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!productId) {
      setError("Add a product first.");
      return;
    }
    const first = sellChannels.find((c) => ["facebook", "instagram", "tiktok", "messenger"].includes(c));
    void fetch("/api/checkout-links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [{ productId, quantity: 1 }],
        shareChannel: first ?? (sellChannels.length > 0 ? "other" : null),
        deliveryMode: pickupEnabled ? "both" : "delivery",
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error ?? "Couldn't make your link.");
        setLink(data.link);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't make your link."));
  }, [productId, sellChannels, pickupEnabled]);

  if (error) {
    return (
      <div className="space-y-4">
        <AuthError message={error} />
        <button type="button" onClick={onBack} className={primaryBtn}>
          Back to your product
        </button>
      </div>
    );
  }
  if (!link) {
    return (
      <p className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Making your link…
      </p>
    );
  }

  const url = `${linkBase}${link.code}`;
  return (
    <div>
      <SharePanelBody link={link} url={url} onShowQr={() => setShowQr(true)} />
      <button
        type="button"
        disabled={finishing}
        onClick={async () => {
          setFinishing(true);
          await onFinish();
        }}
        className={`${primaryBtn} mt-6`}
      >
        {finishing && <Loader2 className="h-4 w-4 animate-spin" />} Go to my dashboard
      </button>
      <p className="mt-3 text-center text-xs text-slate-400">
        Make more links any time from <span className="text-slate-200">Checkout links</span>. Your full online store is
        optional. Set it up later from <span className="text-slate-200">Storefront look</span>.
      </p>
      {showQr && <QrModal link={link} url={url} onClose={() => setShowQr(false)} />}
    </div>
  );
}
