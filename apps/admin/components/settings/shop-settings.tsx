"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { SettingsShell } from "@/components/settings/settings-shell";
import {
  SettingsActions,
  SettingsCard,
  SettingsField,
  inputClassName,
  useTenantSettings,
} from "@/components/settings/settings-forms";
import { BusinessCategoryPicker } from "@/components/business-category-picker";
import { storefrontUrl } from "@/lib/utils";
import { getShopTemplate, isShopTemplateId, SHOP_BUSINESS_CATEGORIES } from "@gumakart/storefront-themes";

type SellChannel = "facebook" | "messenger" | "instagram" | "tiktok" | "shopee" | "lazada" | "other";

const SELL_CHANNEL_OPTIONS: Array<{ id: SellChannel; label: string }> = [
  { id: "facebook", label: "Facebook" },
  { id: "messenger", label: "Messenger" },
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "shopee", label: "Shopee" },
  { id: "lazada", label: "Lazada" },
  { id: "other", label: "Other" },
];

export function ShopSettingsPage() {
  const { settings, loading, saving, error, saved, save } = useTenantSettings();
  const [categories, setCategories] = useState<string[]>([...SHOP_BUSINESS_CATEGORIES]);
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [category, setCategory] = useState("");
  const [mobile, setMobile] = useState("");
  const [sellChannels, setSellChannels] = useState<SellChannel[]>([]);
  const [chatUrl, setChatUrl] = useState("");
  const [tagline, setTagline] = useState("");
  const [promoTitle, setPromoTitle] = useState("");
  const [promoSubtitle, setPromoSubtitle] = useState("");
  const [localeDefault, setLocaleDefault] = useState("taglish");
  const [currency, setCurrency] = useState("PHP");
  const [timezone, setTimezone] = useState("Asia/Manila");

  useEffect(() => {
    void fetch("/api/onboarding/categories")
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok && Array.isArray(data.categories) && data.categories.length > 0) {
          setCategories(data.categories);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!settings) return;
    setName(settings.name);
    setLegalName(settings.legalName ?? "");
    setCategory(settings.category ?? "");
    setMobile(settings.settings?.contact?.mobile ?? "");
    setSellChannels((settings.settings?.social?.sellChannels ?? []) as SellChannel[]);
    setChatUrl(settings.settings?.social?.chatUrl ?? "");
    setTagline(settings.themeJson?.tagline ?? "");
    setPromoTitle(settings.themeJson?.promoTitle ?? "");
    setPromoSubtitle(settings.themeJson?.promoSubtitle ?? "");
    setLocaleDefault(settings.localeDefault ?? "taglish");
    setCurrency(settings.currency);
    setTimezone(settings.timezone);
  }, [settings]);

  function toggleChannel(id: SellChannel) {
    setSellChannels((list) => (list.includes(id) ? list.filter((c) => c !== id) : [...list, id]));
  }

  if (loading) return <SettingsShell title="Business" description="Loading…">…</SettingsShell>;

  const templateId = (settings?.themeJson as { templateId?: string } | null | undefined)?.templateId;

  return (
    <SettingsShell title="Business" description="Your shop details, where you sell, and how buyers reach you.">
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="space-y-4">
        <SettingsCard title="Business details">
          <SettingsField label="Shop name" hint="Buyers see this on your checkout links and SMS updates.">
            <input className={inputClassName()} value={name} onChange={(e) => setName(e.target.value)} />
          </SettingsField>
          <SettingsField label="Your mobile number" hint="For new-order and payment alerts. Buyers don't see it.">
            <input
              className={inputClassName()}
              value={mobile}
              inputMode="tel"
              placeholder="0917 123 4567"
              onChange={(e) => setMobile(e.target.value)}
            />
          </SettingsField>
          <SettingsField
            label="Business category"
            hint="Pick the category you already use on Facebook, Shopee, or Lazada."
          >
            <BusinessCategoryPicker
              value={category}
              onChange={setCategory}
              allowedCategories={category && !categories.includes(category) ? [category, ...categories] : categories}
            />
          </SettingsField>
          <SettingsField label="Legal name" hint="Optional — for invoices and BIR records.">
            <input className={inputClassName()} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </SettingsField>
        </SettingsCard>

        <SettingsCard title="Where you sell">
          <div>
            <p className="mb-1 block text-sm font-medium text-foreground">Where do you sell now?</p>
            <div className="flex flex-wrap gap-2">
              {SELL_CHANNEL_OPTIONS.map((option) => {
                const on = sellChannels.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleChannel(option.id)}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                      on
                        ? "border-violet-600 bg-violet-600 text-white"
                        : "border-border bg-background text-foreground hover:border-violet-300"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <SettingsField
            label="Page or chat link"
            hint={'After ordering, buyers get a "Back to chat" button to this link. Example: m.me/yourpage, wa.me/639171234567, or your Facebook page.'}
          >
            <input
              className={inputClassName()}
              value={chatUrl}
              inputMode="url"
              placeholder="m.me/yourpage"
              onChange={(e) => setChatUrl(e.target.value)}
            />
          </SettingsField>
        </SettingsCard>

        <SettingsCard title="Online store (optional)">
          <SettingsField label="Shop URL" hint="Contact support to change your URL.">
            <input className={inputClassName()} value={settings?.slug ?? ""} readOnly disabled />
          </SettingsField>
          {settings?.slug && (
            <Link
              href={storefrontUrl(settings.slug)}
              target="_blank"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:text-violet-900"
            >
              View online store
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
          <p className="text-sm text-muted-foreground">
            Store look:{" "}
            <span className="font-medium text-foreground">
              {templateId && isShopTemplateId(templateId) ? getShopTemplate(templateId).label : templateId || "Not set up yet"}
            </span>{" "}
            ·{" "}
            <Link href="/launch?changeTemplate=1" className="font-medium text-violet-700 hover:text-violet-900">
              {templateId ? "Change" : "Set up"}
            </Link>
          </p>
          <SettingsField label="Tagline" hint="Shown under your shop name on the online store.">
            <input className={inputClassName()} value={tagline} onChange={(e) => setTagline(e.target.value)} />
          </SettingsField>
          <SettingsField label="Promo headline" hint="Shown on your online store homepage.">
            <input
              className={inputClassName()}
              value={promoTitle}
              onChange={(e) => setPromoTitle(e.target.value)}
              placeholder="Free delivery on orders ₱500+"
            />
          </SettingsField>
          <SettingsField label="Promo subtext">
            <input
              className={inputClassName()}
              value={promoSubtitle}
              onChange={(e) => setPromoSubtitle(e.target.value)}
              placeholder="Order before 8 PM for same-day delivery"
            />
          </SettingsField>
        </SettingsCard>

        <SettingsCard title="Regional">
          <SettingsField label="Default language">
            <select className={inputClassName()} value={localeDefault} onChange={(e) => setLocaleDefault(e.target.value)}>
              <option value="taglish">Taglish</option>
              <option value="en">English</option>
              <option value="fil">Filipino</option>
            </select>
          </SettingsField>
          <SettingsField label="Currency">
            <input className={inputClassName()} value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </SettingsField>
          <SettingsField label="Timezone">
            <input className={inputClassName()} value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </SettingsField>
        </SettingsCard>

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <SettingsActions
          saving={saving}
          saved={saved}
          onSave={() =>
            save({
              name,
              legalName: legalName || null,
              category: category || null,
              tagline,
              promoTitle,
              promoSubtitle,
              localeDefault: localeDefault as "en" | "fil" | "taglish",
              currency,
              timezone,
              settings: {
                contact: { mobile },
                social: { sellChannels, chatUrl },
              },
            })
          }
        />
      </div>
    </SettingsShell>
  );
}
