"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, Minus, Plus, MessageCircle, ShoppingBag } from "lucide-react";
import type { DemoProduct } from "@/lib/demo-data";
import { cartLineKey, useCart } from "@/lib/cart";
import { ctaTextColor, solidCtaColor } from "@/lib/color-contrast";
import { resolveCommerceChrome } from "@gumakart/storefront-themes";

export function AddToCartButton({
  tenantSlug,
  product,
  accent,
  category,
}: {
  tenantSlug: string;
  product: DemoProduct;
  accent: string;
  /** Tenant business category — drives retail vs service CTA language. */
  category?: string | null;
}) {
  // Resolve chrome on the client — never pass chrome objects (they include functions)
  // from Server Components into this client boundary.
  const chrome = resolveCommerceChrome(category);
  const { items, addItem, setQty, ready } = useCart(tenantSlug);
  const [justAdded, setJustAdded] = useState(false);
  const bg = solidCtaColor(accent);
  const fg = ctaTextColor(bg);

  // Phase 9: sizes/colours. Start on the first available variant.
  const options = product.options ?? [];
  const variants = product.variants ?? [];
  const hasVariants = options.length > 0 && variants.length > 0;
  const [picked, setPicked] = useState<Record<string, string>>(() => {
    const first = variants.find((v) => v.available) ?? variants[0];
    return first ? { ...first.options } : {};
  });
  const selected = useMemo(
    () => (hasVariants ? variants.find((v) => options.every((o) => v.options[o.name] === picked[o.name])) ?? null : null),
    [hasVariants, variants, options, picked]
  );

  /** Is there an available variant with this value, given the other picks? */
  function valueAvailable(optionName: string, value: string): boolean {
    return variants.some(
      (v) =>
        v.available &&
        v.options[optionName] === value &&
        options.every((o) => o.name === optionName || !picked[o.name] || v.options[o.name] === picked[o.name])
    );
  }

  const lineKey = hasVariants ? (selected?.id ?? "") : product.id;
  const inCart = items.find((item) => cartLineKey(item) === lineKey);
  const Icon = chrome.mode === "service" ? MessageCircle : ShoppingBag;
  const canAdd = ready && (!hasVariants || Boolean(selected?.available));

  function handleAdd() {
    if (hasVariants && !selected) return;
    addItem({
      productId: product.id,
      slug: product.slug,
      title: product.title,
      price: selected ? selected.price : Number(product.price),
      image: selected?.image || product.image,
      variantId: selected?.id ?? null,
      variantTitle: selected?.title ?? null,
    });
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1600);
  }

  const picker = hasVariants ? (
    <div className="mt-6 w-full space-y-4 md:max-w-md">
      {options.map((option) => (
        <fieldset key={option.name}>
          <legend className="mb-2 text-sm font-semibold text-neutral-800">
            {option.name}
            {picked[option.name] ? <span className="font-normal text-neutral-500">: {picked[option.name]}</span> : null}
          </legend>
          <div className="flex flex-wrap gap-2">
            {option.values.map((value) => {
              const active = picked[option.name] === value;
              const available = valueAvailable(option.name, value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPicked((p) => ({ ...p, [option.name]: value }))}
                  className={`min-w-[3rem] rounded-full border px-4 py-2 text-sm font-medium transition ${
                    active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-500"
                  } ${available ? "" : "line-through opacity-50"}`}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <p className="text-sm text-neutral-600">
        {selected ? (
          <>
            <span className="text-lg font-semibold text-neutral-900">{formatPeso(selected.price)}</span>
            {selected.compareAtPrice && selected.compareAtPrice > selected.price ? (
              <span className="ml-2 text-neutral-400 line-through">{formatPeso(selected.compareAtPrice)}</span>
            ) : null}
            {selected.available ? null : <span className="ml-2 font-medium text-red-600">Sold out</span>}
          </>
        ) : (
          "This combination isn't available."
        )}
      </p>
    </div>
  ) : null;

  if (!inCart) {
    return (
      <>
      {picker}
      <div className={`${hasVariants ? "mt-5" : "mt-8"} w-full md:max-w-md`}>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full py-4 text-base font-semibold shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: bg, color: fg }}
        >
          <Icon className="h-5 w-5" />
          {!ready ? "Loading…" : hasVariants && !selected?.available ? "Sold out" : chrome.addLabel}
        </button>
        {chrome.ctaHint ? (
          <p className="mt-2 text-center text-xs text-neutral-500">{chrome.ctaHint}</p>
        ) : null}
      </div>
      </>
    );
  }

  return (
    <>
    {picker}
    <div className={`${hasVariants ? "mt-5" : "mt-8"} flex w-full flex-col gap-3 md:max-w-md`}>
      <div className="flex items-center justify-between rounded-full border border-neutral-200 p-1.5">
        <button
          type="button"
          aria-label="Decrease quantity"
          onClick={() => setQty(lineKey, inCart.qty - 1)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 transition hover:bg-neutral-200"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="text-base font-semibold">
          {justAdded ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-600">
              <Check className="h-4 w-4" /> Added
            </span>
          ) : (
            chrome.inCartLabel(inCart.qty)
          )}
        </span>
        <button
          type="button"
          aria-label="Increase quantity"
          onClick={() => setQty(lineKey, inCart.qty + 1)}
          className="flex h-11 w-11 items-center justify-center rounded-full transition hover:opacity-90"
          style={{ backgroundColor: bg, color: fg }}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <Link
        href={`/${tenantSlug}/checkout`}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full py-4 text-base font-semibold shadow-sm transition hover:opacity-90"
        style={{ backgroundColor: bg, color: fg }}
      >
        {chrome.checkoutLabel}
      </Link>
    </div>
    </>
  );
}

function formatPeso(amount: number): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}
