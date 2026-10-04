"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { AuthField, authInputClassName } from "@/components/auth-layout";
import { BusinessCategoryPicker } from "@/components/business-category-picker";
import { SHOP_BUSINESS_CATEGORIES } from "@gumakart/storefront-themes";

/**
 * Onboarding step 1 — "Your business" (plan §9). Shared by email signup and
 * Google signup. The shop URL is generated from the name; there's no theme or
 * "vibe" question any more (the online store is optional and comes later).
 */

export type SellChannel = "facebook" | "instagram" | "tiktok" | "messenger" | "shopee" | "lazada" | "other";

export interface BusinessForm {
  shopName: string;
  mobile: string;
  category: string;
  sellChannels: SellChannel[];
  chatUrl: string;
}

export const EMPTY_BUSINESS: BusinessForm = {
  shopName: "",
  mobile: "",
  category: "",
  sellChannels: [],
  chatUrl: "",
};

const CHANNELS: Array<{ id: SellChannel; label: string }> = [
  { id: "facebook", label: "Facebook" },
  { id: "messenger", label: "Messenger" },
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "shopee", label: "Shopee" },
  { id: "lazada", label: "Lazada" },
  { id: "other", label: "Other" },
];

const PH_MOBILE = /^(09\d{9}|\+?639\d{9})$/;

/** Returns a message for the first problem, or null when the form can be sent. */
export function validateBusiness(form: BusinessForm): string | null {
  if (form.shopName.trim().length < 2) return "Enter your shop or business name.";
  if (!PH_MOBILE.test(form.mobile.replace(/[\s-]/g, ""))) return "Enter your mobile number, e.g. 0917 123 4567.";
  if (!form.category.trim()) return "Choose your business category.";
  return null;
}

function slugPreview(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function BusinessFields({
  value,
  onChange,
}: {
  value: BusinessForm;
  onChange: (next: BusinessForm) => void;
}) {
  const [categories, setCategories] = useState<string[]>([...SHOP_BUSINESS_CATEGORIES]);
  useEffect(() => {
    void fetch("/api/onboarding/categories")
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok && Array.isArray(data.categories) && data.categories.length > 0) setCategories(data.categories);
      })
      .catch(() => undefined);
  }, []);

  const set = <K extends keyof BusinessForm>(key: K, v: BusinessForm[K]) => onChange({ ...value, [key]: v });
  const toggleChannel = (id: SellChannel) =>
    set(
      "sellChannels",
      value.sellChannels.includes(id) ? value.sellChannels.filter((c) => c !== id) : [...value.sellChannels, id]
    );
  const preview = slugPreview(value.shopName);

  return (
    <>
      <AuthField label="Shop or business name" id="shopName">
        <input
          id="shopName"
          required
          value={value.shopName}
          onChange={(e) => set("shopName", e.target.value)}
          className={authInputClassName}
          placeholder="Aling Nena's Kakanin"
          autoComplete="organization"
        />
        {preview.length >= 3 && (
          <p className="mt-1.5 text-xs text-slate-400">
            Your shop link will be like <span className="font-mono text-slate-300">kart.guma.one/{preview}</span>. We&apos;ll
            pick a free one.
          </p>
        )}
      </AuthField>

      <AuthField label="Mobile number" id="mobile">
        <input
          id="mobile"
          required
          inputMode="tel"
          autoComplete="tel"
          value={value.mobile}
          onChange={(e) => set("mobile", e.target.value)}
          className={authInputClassName}
          placeholder="0917 123 4567"
        />
        <p className="mt-1.5 text-xs text-slate-400">For new-order alerts. Buyers don&apos;t see this.</p>
      </AuthField>

      <BusinessCategoryPicker
        value={value.category}
        onChange={(category) => set("category", category)}
        allowedCategories={categories}
      />

      <div>
        <p className="text-sm font-medium text-slate-100">Where do you sell now?</p>
        <p className="mt-0.5 text-xs text-slate-400">Pick all that apply. Your checkout link works with all of them.</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {CHANNELS.map((c) => {
            const on = value.sellChannels.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleChannel(c.id)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition ${
                  on
                    ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-200"
                    : "border-white/10 text-slate-300 hover:bg-white/[0.05]"
                }`}
              >
                {on && <Check className="h-3.5 w-3.5" />}
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <AuthField label="Your page or chat link (optional)" id="chatUrl">
        <input
          id="chatUrl"
          value={value.chatUrl}
          onChange={(e) => set("chatUrl", e.target.value)}
          className={authInputClassName}
          placeholder="m.me/yourpage or facebook.com/yourpage"
          inputMode="url"
        />
        <p className="mt-1.5 text-xs text-slate-400">
          After ordering, buyers get a &ldquo;Back to chat&rdquo; button that opens this.
        </p>
      </AuthField>
    </>
  );
}
