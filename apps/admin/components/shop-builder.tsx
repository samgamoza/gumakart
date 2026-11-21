"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card } from "@gumakart/ui";
import { BRAND_PALETTES } from "@gumakart/storefront-themes";
import type { ResolvedShopTheme, ShopDisplayFont } from "@gumakart/storefront-themes";
import { modelStoreUrl } from "@/lib/utils";

const FONT_OPTIONS: Array<{ id: ShopDisplayFont; label: string; hint: string }> = [
  { id: "bricolage", label: "Rounded", hint: "Friendly & modern" },
  { id: "system", label: "Classic", hint: "Clean & neutral" },
  { id: "mono-accent", label: "Techy", hint: "Bold & digital" },
];

interface TemplateOption {
  id: string;
  label: string;
  description: string;
  mood: string;
  tags: string[];
  previewGradient: string;
  minPlan: string;
  locked: boolean;
}

interface TemplateTier {
  tier: "basic" | "standard" | "advanced";
  label: string;
  description: string;
  templates: TemplateOption[];
}

interface ShopUrls {
  storefront: string;
  preview: string;
}

function ShopPreviewMock({
  shopName,
  theme,
}: {
  shopName: string;
  theme: ResolvedShopTheme;
}) {
  const isDark = theme.mode === "dark";

  return (
    <div
      className="overflow-hidden rounded-2xl border shadow-inner"
      style={{
        background: theme.background,
        color: theme.foreground,
        borderColor: theme.border,
      }}
    >
      <div
        className="relative h-28 px-4 pt-4"
        style={{
          background:
            theme.hero === "mesh" || theme.hero === "chrome"
              ? theme.previewGradient
              : `linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor})`,
        }}
      >
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              theme.hero === "noise"
                ? "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.8), transparent 40%)"
                : undefined,
          }}
        />
        <div className="relative flex items-end gap-3">
          <div
            className="flex h-14 w-14 items-center justify-center border-4 text-2xl shadow-lg"
            style={{
              borderRadius: theme.radius,
              borderColor: isDark ? theme.foreground : "#fff",
              backgroundColor: theme.cardBackground,
            }}
          >
            🛍️
          </div>
          <div className="pb-1">
            <p className="text-sm font-bold">{shopName}</p>
            <p className="text-[10px] opacity-80">{theme.tagline}</p>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div
          className="rounded-xl p-3 text-xs"
          style={{
            background: `linear-gradient(135deg, ${theme.primaryColor}22, ${theme.accentColor}33)`,
            border: `1px solid ${theme.border}`,
            borderRadius: theme.radius,
          }}
        >
          <p className="font-semibold">{theme.promoTitle}</p>
          <p className="mt-1 opacity-75">{theme.promoSubtitle}</p>
        </div>

        <div className={theme.card === "grid" || theme.layout === "bento" ? "grid grid-cols-2 gap-2" : "space-y-2"}>
          {[1, 2].map((item) => (
            <div
              key={item}
              className="flex gap-2 p-2"
              style={{
                background: theme.cardBackground,
                border:
                  theme.card === "brutal"
                    ? `2px solid ${theme.foreground}`
                    : `1px solid ${theme.border}`,
                borderRadius: theme.card === "brutal" ? "0.5rem" : theme.radius,
                boxShadow: theme.card === "glass-tile" ? "0 8px 32px rgba(0,0,0,0.08)" : undefined,
              }}
            >
              <div
                className="h-10 w-10 shrink-0"
                style={{
                  borderRadius: theme.radius,
                  background: `linear-gradient(135deg, ${theme.primaryColor}55, ${theme.accentColor}88)`,
                }}
              />
              <div className="min-w-0 flex-1">
                <div
                  className="h-2 w-3/4 rounded"
                  style={{ backgroundColor: theme.foreground, opacity: 0.15 }}
                />
                <div
                  className="mt-2 h-2 w-1/3 rounded"
                  style={{ backgroundColor: theme.primaryColor, opacity: 0.8 }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ShopBuilder() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [shopName, setShopName] = useState("My Shop");
  const [tiers, setTiers] = useState<TemplateTier[]>([]);
  const [urls, setUrls] = useState<ShopUrls | null>(null);
  const [subscriptionPlan, setSubscriptionPlan] = useState("free");
  const [selectedTemplateId, setSelectedTemplateId] = useState("clean-guma");
  const [tagline, setTagline] = useState("");
  const [promoTitle, setPromoTitle] = useState("");
  const [promoSubtitle, setPromoSubtitle] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#059669");
  const [accentColor, setAccentColor] = useState("#f59e0b");
  const [displayFont, setDisplayFont] = useState<ShopDisplayFont>("bricolage");
  const [previewTheme, setPreviewTheme] = useState<ResolvedShopTheme | null>(null);
  const [lockedPrompt, setLockedPrompt] = useState<TemplateOption | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [shopRes, templatesRes] = await Promise.all([
      fetch("/api/shop"),
      fetch("/api/shop/templates"),
    ]);

    const shopData = await shopRes.json();
    const templatesData = await templatesRes.json();
    setLoading(false);

    if (!shopData.ok) {
      setError(shopData.error ?? "Could not load shop settings.");
      return;
    }

    if (templatesData.ok) {
      setTiers(templatesData.tiers);
      setSubscriptionPlan(templatesData.subscriptionPlan ?? "free");
      setSelectedTemplateId(templatesData.currentTemplateId ?? "clean-guma");
    }

    setShopName(shopData.shop.tenant.name);
    setUrls(shopData.urls);
    setPreviewTheme(shopData.theme);
    setTagline(shopData.theme.tagline ?? "");
    setPromoTitle(shopData.theme.promoTitle ?? "");
    setPromoSubtitle(shopData.theme.promoSubtitle ?? "");
    setPrimaryColor(shopData.theme.primaryColor ?? "#059669");
    setAccentColor(shopData.theme.accentColor ?? "#f59e0b");
    setDisplayFont(shopData.theme.displayFont ?? "bricolage");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const livePreviewTheme = useMemo<ResolvedShopTheme | null>(() => {
    if (!previewTheme) return null;
    return {
      ...previewTheme,
      tagline: tagline || previewTheme.tagline,
      promoTitle: promoTitle || previewTheme.promoTitle,
      promoSubtitle: promoSubtitle || previewTheme.promoSubtitle,
      primaryColor,
      accentColor,
      displayFont,
    };
  }, [previewTheme, tagline, promoTitle, promoSubtitle, primaryColor, accentColor, displayFont]);

  function applyPalette(paletteId: string) {
    const palette = BRAND_PALETTES.find((p) => p.id === paletteId);
    if (!palette) return;
    setSaved(false);
    setPrimaryColor(palette.primary);
    setAccentColor(palette.accent);
  }

  function shuffleStyle() {
    const palette = BRAND_PALETTES[Math.floor(Math.random() * BRAND_PALETTES.length)];
    const font = FONT_OPTIONS[Math.floor(Math.random() * FONT_OPTIONS.length)];
    if (!palette || !font) return;
    setSaved(false);
    setPrimaryColor(palette.primary);
    setAccentColor(palette.accent);
    setDisplayFont(font.id);
  }

  async function selectTemplate(template: TemplateOption) {
    if (template.locked) {
      setLockedPrompt(template);
      setError(null);
      return;
    }

    setLockedPrompt(null);
    setSaved(false);
    setSelectedTemplateId(template.id);

    const res = await fetch("/api/shop", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: template.id }),
    });
    const data = await res.json();

    if (!data.ok) {
      setError(data.error ?? "Could not apply template.");
      return;
    }

    setPreviewTheme(data.theme);
    setPrimaryColor(data.theme.primaryColor);
    setAccentColor(data.theme.accentColor);
  }

  async function handleSaveDetails(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const res = await fetch("/api/shop", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tagline,
        promoTitle,
        promoSubtitle,
        primaryColor,
        accentColor,
        displayFont,
      }),
    });

    const data = await res.json();
    setSaving(false);

    if (!data.ok) {
      setError(data.error ?? "Could not save shop design.");
      return;
    }

    setPreviewTheme(data.theme);
    setSaved(true);
  }

  async function handlePublishDraft() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish" }),
    });
    const data = await res.json();
    setSaving(false);
    if (!data.ok) {
      setError(data.error ?? "Could not publish.");
      return;
    }
    setSaved(true);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading shop builder…</p>;
  }

  return (
    <div className="space-y-6">
      <Card className="border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🎨</span>
              <h2 className="text-lg font-semibold">Appearance</h2>
              <Badge className="bg-emerald-100 text-emerald-800">Draft</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Edits save as a <strong>draft</strong>. Publish from{" "}
              <a href="/launch" className="font-medium text-emerald-700 underline">
                GUMA Launch
              </a>{" "}
              (or Publish below) before buyers see changes. New shops should complete Launch first.
            </p>
          </div>
          {urls && (
            <div className="flex flex-wrap gap-2">
              <a
                href={urls.preview}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-emerald-200 bg-card px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50"
              >
                Your live preview ↗
              </a>
              <a
                href={modelStoreUrl("shop-builder")}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                See flagship model store ↗
              </a>
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Plan: <span className="font-medium capitalize">{subscriptionPlan}</span> · Basic templates
          included free · Standard & Advanced unlock with Pro / Advance
        </p>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-emerald-700">Shop design saved.</p>}

      {lockedPrompt && (
        <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                {lockedPrompt.label} requires{" "}
                {lockedPrompt.minPlan === "pro" ? "Pro Live" : "Starter"}
              </p>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Preview how flagship shops look with live selling, flash deals, and more on our model
                store — then upgrade to unlock{" "}
                {lockedPrompt.minPlan === "pro" ? "Pro Live" : "Starter"} templates for your shop.
              </p>
            </div>
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-muted-foreground"
              onClick={() => setLockedPrompt(null)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={modelStoreUrl("shop-builder")}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-200"
            >
              See model store ↗
            </a>
            <Link
              href={`/settings/subscription?highlight=${lockedPrompt.minPlan}&ref=shop-builder`}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Upgrade to {lockedPrompt.minPlan === "pro" ? "Pro Live" : "Starter"}
            </Link>
          </div>
        </Card>
      )}

      {subscriptionPlan === "free" && urls && (
        <Card className="border-border p-5">
          <h3 className="font-semibold text-foreground">Compare: your shop vs flagship</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Open both side by side on your phone. The model store shows what Pro &amp; Advance
            features feel like — your live preview is what customers see today on Free.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <a
              href={urls.preview}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-border bg-card p-4 transition hover:border-emerald-300 hover:shadow-sm"
            >
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Your shop</p>
              <p className="mt-1 font-medium text-foreground">{shopName}</p>
              <p className="mt-2 text-xs text-muted-foreground">Current plan · Basic templates</p>
            </a>
            <a
              href={modelStoreUrl("shop-builder")}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-amber-200 bg-gradient-to-br from-[#1a1a2e] to-[#16213e] p-4 text-white transition hover:shadow-md"
            >
              <p className="text-xs font-bold uppercase tracking-wide text-amber-300">Model store</p>
              <p className="mt-1 font-medium">Guma Supply Co.</p>
              <p className="mt-2 text-xs text-muted-foreground">Pro + Advance features · Staged demo</p>
            </a>
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          {tiers.map((tier) => (
            <section key={tier.tier}>
              <div className="mb-3">
                <h3 className="font-semibold text-foreground">{tier.label}</h3>
                <p className="text-sm text-muted-foreground">{tier.description}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {tier.templates.map((template) => {
                  const selected = selectedTemplateId === template.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      disabled={template.locked}
                      onClick={() => selectTemplate(template)}
                      className={`rounded-2xl border p-3 text-left transition ${
                        selected
                          ? "border-emerald-500 bg-card ring-2 ring-emerald-500"
                          : template.locked
                            ? "cursor-not-allowed border-border bg-muted opacity-70"
                            : "border-border bg-card hover:border-border"
                      }`}
                    >
                      <div
                        className="mb-3 h-24 rounded-xl"
                        style={{ background: template.previewGradient }}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{template.label}</p>
                        {selected && <Badge>Active</Badge>}
                        {template.locked && (
                          <Badge className="bg-muted text-muted-foreground capitalize">
                            {template.minPlan}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
                      <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {template.mood}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-foreground">Customize copy & colors</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Fine-tune your tagline, promo banner, brand colors, and font on top of the
                  template.
                </p>
              </div>
              <button
                type="button"
                onClick={shuffleStyle}
                className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                🎲 Surprise me
              </button>
            </div>

            <div className="mt-4">
              <span className="mb-2 block text-xs font-medium text-muted-foreground">Color palettes</span>
              <div className="flex flex-wrap gap-2">
                {BRAND_PALETTES.map((palette) => {
                  const active =
                    palette.primary.toLowerCase() === primaryColor.toLowerCase() &&
                    palette.accent.toLowerCase() === accentColor.toLowerCase();
                  return (
                    <button
                      key={palette.id}
                      type="button"
                      title={palette.label}
                      onClick={() => applyPalette(palette.id)}
                      className={`flex h-9 items-center gap-0 overflow-hidden rounded-full border transition ${
                        active
                          ? "border-emerald-500 ring-2 ring-emerald-500"
                          : "border-border hover:border-border"
                      }`}
                    >
                      <span className="h-9 w-6" style={{ backgroundColor: palette.primary }} />
                      <span className="h-9 w-6" style={{ backgroundColor: palette.accent }} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4">
              <span className="mb-2 block text-xs font-medium text-muted-foreground">Display font</span>
              <div className="grid grid-cols-3 gap-2">
                {FONT_OPTIONS.map((font) => (
                  <button
                    key={font.id}
                    type="button"
                    onClick={() => {
                      setSaved(false);
                      setDisplayFont(font.id);
                    }}
                    className={`rounded-xl border p-2.5 text-left transition ${
                      displayFont === font.id
                        ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500"
                        : "border-border bg-card hover:border-border"
                    }`}
                  >
                    <p
                      className={`text-sm font-semibold text-foreground ${
                        font.id === "mono-accent" ? "font-mono" : ""
                      }`}
                    >
                      {font.label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{font.hint}</p>
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleSaveDetails} className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block md:col-span-2">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Shop tagline</span>
                <input
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="Premium cakes, made to order 🎂"
                  className="h-10 w-full rounded-xl border border-border px-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Promo headline</span>
                <input
                  value={promoTitle}
                  onChange={(e) => setPromoTitle(e.target.value)}
                  className="h-10 w-full rounded-xl border border-border px-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Promo subtext</span>
                <input
                  value={promoSubtitle}
                  onChange={(e) => setPromoSubtitle(e.target.value)}
                  className="h-10 w-full rounded-xl border border-border px-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Primary color</span>
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-10 w-full rounded-xl border border-border bg-card px-2"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Accent color</span>
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-10 w-full rounded-xl border border-border bg-card px-2"
                />
              </label>
              <div className="md:col-span-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save draft"}
                </Button>
                <Button
                  type="button"
                  disabled={saving}
                  className="bg-emerald-700 hover:bg-emerald-800"
                  onClick={() => void handlePublishDraft()}
                >
                  Publish to storefront
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-foreground">Live preview</p>
            {livePreviewTheme && (
              <ShopPreviewMock shopName={shopName} theme={livePreviewTheme} />
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Your customers see the full layout on mobile — cards, hero, and header all change
              with the template you pick.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
