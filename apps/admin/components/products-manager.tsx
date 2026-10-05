"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, formatPrice } from "@gumakart/ui";
import { ProductVariantsEditor } from "@/components/product-variants-editor";
import {
  formatProductPriceLine,
  productPricingKindForCategory,
  type ProductPricingMeta,
  type ProductUnitType,
  type ServicePriceStyle,
} from "@gumakart/storefront-themes";

const PRODUCT_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif,.avif";
const PRODUCT_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function isAllowedProductImage(file: File): boolean {
  if (PRODUCT_IMAGE_TYPES.has(file.type)) return true;
  // Some browsers omit MIME for AVIF — allow by extension.
  return /\.avif$/i.test(file.name);
}

interface ProductRow {
  id: string;
  title: string;
  slug: string;
  basePrice: string;
  compareAtPrice: string | null;
  descriptionHtml: string | null;
  status: string;
  stockQty: number;
  aiGenerated: boolean;
  imageUrl: string | null;
  isMain?: boolean;
  metadataJson?: ProductPricingMeta | null;
  /** Phase 9: sizes/colours. stockQty is the total across variants. */
  hasOptions?: boolean;
  variantCount?: number;
  lowestVariantStock?: number;
}

interface ProductDraft {
  title: string;
  slug: string;
  descriptionHtml: string;
  shortDescription: string;
  basePrice: string;
  compareAtPrice: string;
  stockQty: string;
  status: "draft" | "active";
  tags: string[];
  photoShotList: string[];
  imageUrl: string;
  isMain: boolean;
  unitType: ProductUnitType;
  unitCustom: string;
  servicePriceStyle: ServicePriceStyle;
}

interface ShopContext {
  name: string;
  category: string | null;
}

const EMPTY_DRAFT: ProductDraft = {
  title: "",
  slug: "",
  descriptionHtml: "",
  shortDescription: "",
  basePrice: "",
  compareAtPrice: "",
  stockQty: "10",
  status: "active",
  tags: [],
  photoShotList: [],
  imageUrl: "",
  isMain: false,
  unitType: "pc",
  unitCustom: "",
  servicePriceStyle: "base_minimum",
};

const STOREFRONT_URL =
  process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3010";

function productImageSrc(url: string): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  // Local disk uploads live under apps/web/public — preview via admin proxy
  // so the Products UI works even if the storefront isn't running.
  if (url.startsWith("/uploads/products/")) {
    return `/api/products/media?path=${encodeURIComponent(url)}`;
  }
  return `${STOREFRONT_URL}${url}`;
}

/** Plain text for the description editor — preserve spaces/newlines (no trim). */
function htmlToPlainDescription(html: string): string {
  return html
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function plainDescriptionToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  if (!escaped) return "";
  return `<p>${escaped.replace(/\n/g, "</p><p>")}</p>`;
}

export function ProductsManager() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [shop, setShop] = useState<ShopContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [dragOverPhoto, setDragOverPhoto] = useState(false);
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [enhancingDescription, setEnhancingDescription] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [changeRequestId, setChangeRequestId] = useState<string | null>(null);
  const [requiresReview, setRequiresReview] = useState(false);
  const [pricingNote, setPricingNote] = useState<string | null>(null);
  const [suggestingPrice, setSuggestingPrice] = useState(false);
  const [descriptionNote, setDescriptionNote] = useState<string | null>(null);
  const [variantsFor, setVariantsFor] = useState<ProductRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [productsRes, shopRes] = await Promise.all([
      fetch("/api/products"),
      fetch("/api/shop"),
    ]);
    const productsData = await productsRes.json();
    const shopData = await shopRes.json();
    if (productsData.ok) setProducts(productsData.products);
    if (shopData.ok) {
      setShop({
        name: shopData.shop.tenant.name,
        category: shopData.shop.tenant.category,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pricingKind = useMemo(
    () => productPricingKindForCategory(shop?.category),
    [shop?.category]
  );

  function buildPricingMeta(d: ProductDraft): ProductPricingMeta | null {
    if (pricingKind === "food") {
      return {
        unitType: d.unitType,
        ...(d.unitType === "other" && d.unitCustom.trim()
          ? { unitCustom: d.unitCustom.trim() }
          : {}),
      };
    }
    if (pricingKind === "service") {
      return { servicePriceStyle: d.servicePriceStyle };
    }
    return null;
  }

  function priceLineForProduct(product: ProductRow): string {
    return formatProductPriceLine({
      category: shop?.category,
      basePrice: Number(product.basePrice),
      compareAtPrice: product.compareAtPrice ? Number(product.compareAtPrice) : null,
      meta: product.metadataJson ?? null,
      formatMoney: (n) => formatPrice(n),
    });
  }

  function stockLine(product: ProductRow): string {
    if (pricingKind === "service") return "";
    if (product.hasOptions) {
      const low = (product.lowestVariantStock ?? 0) === 0 ? " · some sold out" : "";
      return ` · ${product.variantCount ?? 0} variants · Stock: ${product.stockQty}${low}`;
    }
    return ` · Stock: ${product.stockQty}`;
  }

  function openCreateForm() {
    setShowForm(true);
    setError(null);
    setDraft({ ...EMPTY_DRAFT, isMain: products.length === 0 });
    setEditingId(null);
    setNotice(null);
    setChangeRequestId(null);
    setRequiresReview(false);
    setPricingNote(null);
    setDescriptionNote(null);
    setOriginalImageUrl(null);
  }

  function closeCreateForm() {
    setShowForm(false);
    setDraft(null);
    setError(null);
    setOriginalImageUrl(null);
    setEnhancing(false);
    setEnhancingDescription(false);
    setEditingId(null);
    setChangeRequestId(null);
    setRequiresReview(false);
    setPricingNote(null);
    setDescriptionNote(null);
  }

  function startEdit(product: ProductRow) {
    setShowForm(true);
    setEditingId(product.id);
    setError(null);
    setNotice(null);
    setChangeRequestId(null);
    setRequiresReview(false);
    setPricingNote(null);
    setDescriptionNote(null);
    setOriginalImageUrl(product.imageUrl);
    setDraft({
      title: product.title,
      slug: product.slug,
      descriptionHtml: product.descriptionHtml ?? "",
      shortDescription: "",
      basePrice: String(Number(product.basePrice)),
      compareAtPrice: product.compareAtPrice ? String(Number(product.compareAtPrice)) : "",
      stockQty: String(product.stockQty),
      // Archived products come back as drafts so they stay hidden until re-activated.
      status: product.status === "active" ? "active" : "draft",
      tags: [],
      photoShotList: [],
      imageUrl: product.imageUrl ?? "",
      isMain: Boolean(product.isMain),
      unitType: product.metadataJson?.unitType ?? "pc",
      unitCustom: product.metadataJson?.unitCustom ?? "",
      servicePriceStyle: product.metadataJson?.servicePriceStyle ?? "base_minimum",
    });
  }

  async function setAsMainProduct(product: ProductRow) {
    if (product.isMain) return;
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isMain: true }),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error ?? "Could not set main product.");
      return;
    }
    setNotice(`“${product.title}” is now your main / identity product.`);
    await load();
  }

  async function handleDelete(product: ProductRow) {
    const confirmed = window.confirm(
      `Delete "${product.title}"? If it has past orders it will be archived instead.`
    );
    if (!confirmed) return;

    setDeletingId(product.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/products/${product.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Could not delete product.");
        return;
      }
      setNotice(
        data.result === "archived"
          ? `"${product.title}" has past orders, so it was archived (hidden from your shop).`
          : `"${product.title}" deleted.`
      );
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  async function uploadProductImage(file: File) {
    if (!isAllowedProductImage(file)) {
      setError("Use a JPG, PNG, WebP, GIF, or AVIF image.");
      return;
    }
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      setError("Image must be 5 MB or smaller.");
      return;
    }

    setError(null);
    setUploadingImage(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/products/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Could not upload image.");
        return;
      }

      setDraft((current) =>
        current ? { ...current, imageUrl: data.url } : { ...EMPTY_DRAFT, imageUrl: data.url }
      );
      setOriginalImageUrl(data.url);
    } catch {
      setError("Could not upload image.");
    } finally {
      setUploadingImage(false);
      setDragOverPhoto(false);
    }
  }

  async function handleImageSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await uploadProductImage(file);
  }

  function handlePhotoDragOver(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (uploadingImage) return;
    event.dataTransfer.dropEffect = "copy";
    setDragOverPhoto(true);
  }

  function handlePhotoDragLeave(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDragOverPhoto(false);
  }

  async function handlePhotoDrop(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setDragOverPhoto(false);
    if (uploadingImage) return;
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    await uploadProductImage(file);
  }

  async function handleEnhancePhoto() {
    if (!draft?.imageUrl) return;

    setError(null);
    setEnhancing(true);

    const sourceUrl = originalImageUrl ?? draft.imageUrl;
    const res = await fetch("/api/products/enhance-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: sourceUrl,
      }),
    });

    const data = await res.json();
    setEnhancing(false);

    if (!data.ok) {
      setError(data.error ?? "Could not remove background.");
      return;
    }

    if (!originalImageUrl) {
      setOriginalImageUrl(sourceUrl);
    }
    setDraft((current) => (current ? { ...current, imageUrl: data.url } : current));
  }

  function useOriginalPhoto() {
    if (!originalImageUrl) return;
    setDraft((current) => (current ? { ...current, imageUrl: originalImageUrl } : current));
  }

  function removeImage() {
    setDraft((current) => (current ? { ...current, imageUrl: "" } : current));
    setOriginalImageUrl(null);
  }

  async function handleEnhanceDescription() {
    if (!draft?.title.trim()) {
      setError("Enter a product name first, then enhance the description.");
      return;
    }

    setError(null);
    setDescriptionNote(null);
    setEnhancingDescription(true);
    try {
      const res = await fetch("/api/products/enhance-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          description: htmlToPlainDescription(draft.descriptionHtml),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Could not enhance description.");
        return;
      }
      setDraft((current) =>
        current
          ? {
              ...current,
              descriptionHtml: data.descriptionHtml,
              shortDescription: data.shortDescription ?? current.shortDescription,
            }
          : current
      );
      setChangeRequestId(data.changeRequestId ?? null);
      setRequiresReview(Boolean(data.requiresReview));
      setDescriptionNote("AI polished your description — review and edit before saving.");
    } finally {
      setEnhancingDescription(false);
    }
  }

  async function handleSuggestPrice() {
    if (!draft?.title.trim()) {
      setError("Enter a product name first, then suggest a nearby price.");
      return;
    }

    setError(null);
    setSuggestingPrice(true);
    try {
      const current = Number(draft.basePrice);
      const res = await fetch("/api/products/suggest-market-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          currentPrice:
            Number.isFinite(current) && current > 0 ? current : undefined,
          productId: editingId ?? undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Could not suggest a price.");
        return;
      }
      const suggestion = data.suggestion;
      setDraft((currentDraft) =>
        currentDraft
          ? {
              ...currentDraft,
              basePrice: String(suggestion.basePrice),
              compareAtPrice: suggestion.compareAtPrice
                ? String(suggestion.compareAtPrice)
                : currentDraft.compareAtPrice,
            }
          : currentDraft
      );
      setChangeRequestId(data.changeRequestId ?? null);
      setRequiresReview(Boolean(data.requiresReview));
      setPricingNote(suggestion.rationale ?? "Nearby market price suggested — review and save.");
    } finally {
      setSuggestingPrice(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;

    setError(null);
    setSaving(true);

    const price = Number(draft.basePrice);
    if (!draft.title.trim()) {
      setError("Product name is required.");
      setSaving(false);
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setError("Enter a valid price.");
      setSaving(false);
      return;
    }

    const compareAt = draft.compareAtPrice ? Number(draft.compareAtPrice) : null;
    if (
      pricingKind === "service" &&
      draft.servicePriceStyle === "value_range" &&
      (!compareAt || compareAt < price)
    ) {
      setError("Enter a max service value that is at least the base / minimum.");
      setSaving(false);
      return;
    }
    if (pricingKind === "food" && draft.unitType === "other" && !draft.unitCustom.trim()) {
      setError("Specify the unit type (e.g. per tray, per kilo).");
      setSaving(false);
      return;
    }

    const metadataJson = buildPricingMeta(draft);
    const stockQty =
      pricingKind === "service" ? Math.max(Number(draft.stockQty) || 999, 1) : Number(draft.stockQty) || 0;
    const comparePayload =
      pricingKind === "service"
        ? draft.servicePriceStyle === "value_range" && compareAt && compareAt >= price
          ? compareAt
          : null
        : compareAt && compareAt > price
          ? compareAt
          : null;

    const res = editingId
      ? await fetch(`/api/products/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draft.title.trim(),
            descriptionHtml:
              draft.descriptionHtml || `<p>${draft.shortDescription || draft.title}</p>`,
            basePrice: price,
            compareAtPrice: comparePayload,
            status: draft.status,
            stockQty,
            imageUrl: draft.imageUrl || null,
            isMain: draft.isMain,
            metadataJson,
            changeRequestId: changeRequestId ?? undefined,
          }),
        })
      : await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draft.title.trim(),
            slug: draft.slug || draft.title,
            descriptionHtml:
              draft.descriptionHtml || `<p>${draft.shortDescription || draft.title}</p>`,
            basePrice: price,
            compareAtPrice: comparePayload ?? undefined,
            status: draft.status,
            stockQty,
            aiGenerated: false,
            imageUrl: draft.imageUrl || undefined,
            isMain: draft.isMain || products.length === 0,
            metadataJson,
            changeRequestId: changeRequestId ?? undefined,
          }),
        });

    const data = await res.json();
    setSaving(false);

    if (!data.ok) {
      setError(data.error ?? "Could not save product.");
      return;
    }

    closeCreateForm();
    await load();
  }

  const editingHasOptions = Boolean(editingId && products.find((p) => p.id === editingId)?.hasOptions);

  return (
    <div>
      {variantsFor ? (
        <ProductVariantsEditor
          productId={variantsFor.id}
          productTitle={variantsFor.title}
          onClose={() => setVariantsFor(null)}
          onSaved={(message) => {
            setVariantsFor(null);
            setNotice(message);
            void load();
          }}
        />
      ) : null}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {shop
              ? `Catalog for ${shop.name}${shop.category ? ` · ${shop.category}` : ""}`
              : "Add products yourself. AI can polish copy or suggest nearby prices."}
          </p>
        </div>
        {showForm ? (
          <Button type="button" variant="secondary" onClick={closeCreateForm}>
            Cancel
          </Button>
        ) : (
          <Button type="button" onClick={openCreateForm}>
            + Add product
          </Button>
        )}
      </div>

      {showForm && draft && (
        <Card className="mb-6 border-white/10 bg-white/[0.03]">
          <div className="mb-5">
            <h3 className="font-semibold text-slate-100">
              {editingId ? "Edit product" : "New product"}
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Fill in the basics yourself. Use AI only to enhance the description or suggest a
              nearby market price.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {changeRequestId && requiresReview && (
              <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100/90">
                An AI suggestion is tracked as a change request. Saving applies it to your catalog.
              </p>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="rounded-xl border border-border bg-card p-4">
              <span className="mb-2 block text-sm font-medium text-foreground">Product photo</span>
              {draft.imageUrl ? (
                <div
                  className={`space-y-4 rounded-xl ${
                    dragOverPhoto ? "ring-2 ring-emerald-500/50 ring-offset-2 ring-offset-card" : ""
                  }`}
                  onDragEnter={handlePhotoDragOver}
                  onDragOver={handlePhotoDragOver}
                  onDragLeave={handlePhotoDragLeave}
                  onDrop={(e) => void handlePhotoDrop(e)}
                >
                  <div className="flex flex-wrap items-start gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={productImageSrc(draft.imageUrl)}
                      alt={draft.title || "Product preview"}
                      className="h-36 w-36 rounded-xl border border-border object-cover bg-muted"
                    />
                    <div className="space-y-2">
                      <p className="text-sm text-slate-300">
                        {dragOverPhoto
                          ? "Drop to replace this photo."
                          : originalImageUrl && draft.imageUrl !== originalImageUrl
                            ? "Background removed — clean photo selected for your shop."
                            : "Photo ready — drag a new file here to replace, or remove the background."}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <label className="inline-flex cursor-pointer items-center rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted">
                          Replace photo
                          <input
                            type="file"
                            accept={PRODUCT_IMAGE_ACCEPT}
                            className="hidden"
                            onChange={handleImageSelect}
                            disabled={uploadingImage}
                          />
                        </label>
                        {originalImageUrl && draft.imageUrl !== originalImageUrl && (
                          <button
                            type="button"
                            onClick={useOriginalPhoto}
                            className="rounded-xl border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
                          >
                            Use original
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={removeImage}
                          className="rounded-xl px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-200">
                          Remove background (free)
                        </p>
                        <p className="text-xs text-slate-500">
                          Cuts out your product and places it on a clean white background.
                        </p>
                      </div>
                      <Button type="button" onClick={handleEnhancePhoto} disabled={enhancing}>
                        {enhancing
                          ? "Removing… (first run may take a minute)"
                          : "Remove background"}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <label
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition ${
                    dragOverPhoto
                      ? "border-emerald-400 bg-emerald-500/10"
                      : "border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]"
                  } ${uploadingImage ? "pointer-events-none opacity-70" : ""}`}
                  onDragEnter={handlePhotoDragOver}
                  onDragOver={handlePhotoDragOver}
                  onDragLeave={handlePhotoDragLeave}
                  onDrop={(e) => void handlePhotoDrop(e)}
                >
                  <input
                    type="file"
                    accept={PRODUCT_IMAGE_ACCEPT}
                    className="hidden"
                    onChange={handleImageSelect}
                    disabled={uploadingImage}
                  />
                  <span className="text-sm font-medium text-slate-200">
                    {uploadingImage
                      ? "Uploading…"
                      : dragOverPhoto
                        ? "Drop photo to upload"
                        : "Drag & drop or click to upload"}
                  </span>
                  <span className="mt-1 text-xs text-slate-400">
                    JPG, PNG, WebP, GIF, or AVIF · up to 5 MB
                  </span>
                </label>
              )}
            </div>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-foreground">Product name</span>
              <input
                required
                value={draft.title}
                onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
                className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                placeholder="e.g. Choco Fudge Cake"
              />
            </label>

            {draft.shortDescription ? (
              <p className="text-sm text-muted-foreground">{draft.shortDescription}</p>
            ) : null}

            <label className="block">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">Description</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={enhancingDescription || !draft.title.trim()}
                  onClick={() => void handleEnhanceDescription()}
                >
                  {enhancingDescription ? "Enhancing…" : "Enhance with AI"}
                </Button>
              </div>
              <textarea
                value={htmlToPlainDescription(draft.descriptionHtml)}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          descriptionHtml: plainDescriptionToHtml(e.target.value),
                          shortDescription: e.target.value.split("\n")[0] ?? "",
                        }
                      : d
                  )
                }
                rows={4}
                placeholder="Write your own description. AI can polish it after."
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
              />
              {descriptionNote ? (
                <p className="mt-1.5 text-xs text-slate-400">{descriptionNote}</p>
              ) : (
                <p className="mt-1.5 text-xs text-slate-500">
                  Optional: AI rewrites for clarity and selling tone — you stay in control.
                </p>
              )}
            </label>

            {pricingKind === "food" && (
              <div className="space-y-2 rounded-xl border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">Sold as</p>
                <p className="text-xs text-slate-400">How customers buy this food item.</p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["pc", "Per pc"],
                      ["box", "Per box"],
                      ["other", "Other — specify"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDraft((d) => (d ? { ...d, unitType: id } : d))}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                        draft.unitType === id
                          ? "border-emerald-500 bg-emerald-600 text-white"
                          : "border-border bg-secondary text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {draft.unitType === "other" && (
                  <input
                    value={draft.unitCustom}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, unitCustom: e.target.value } : d))
                    }
                    placeholder="e.g. per tray, per kilo, per dozen"
                    className="mt-1 h-11 w-full max-w-md rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-slate-500"
                  />
                )}
              </div>
            )}

            {pricingKind === "service" && (
              <div className="space-y-2 rounded-xl border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">Service pricing</p>
                <p className="text-xs text-slate-400">
                  Services use a base / minimum or a value range — not retail stock pricing.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["base_minimum", "Base / minimum"],
                      ["value_range", "Service value range"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() =>
                        setDraft((d) => (d ? { ...d, servicePriceStyle: id } : d))
                      }
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                        draft.servicePriceStyle === id
                          ? "border-emerald-500 bg-emerald-600 text-white"
                          : "border-border bg-secondary text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div
              className={`grid gap-3 ${
                pricingKind === "service" && draft.servicePriceStyle === "base_minimum"
                  ? "sm:grid-cols-1 sm:max-w-xs"
                  : "sm:grid-cols-2 lg:grid-cols-3"
              }`}
            >
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-foreground">
                  {pricingKind === "service"
                    ? draft.servicePriceStyle === "value_range"
                      ? "Minimum (PHP)"
                      : "Base / minimum (PHP)"
                    : pricingKind === "food"
                      ? `Price (PHP)${
                          draft.unitType === "pc"
                            ? " · per pc"
                            : draft.unitType === "box"
                              ? " · per box"
                              : draft.unitCustom.trim()
                                ? ` · per ${draft.unitCustom.trim()}`
                                : ""
                        }`
                      : "Price (PHP)"}
                </span>
                <input
                  required
                  type="number"
                  min="1"
                  disabled={editingHasOptions}
                  title={editingHasOptions ? "Set per size/colour in Sizes & colours" : undefined}
                  value={draft.basePrice}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, basePrice: e.target.value } : d))
                  }
                  className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                />
              </label>

              {pricingKind === "service" && draft.servicePriceStyle === "value_range" ? (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-foreground">
                    Maximum (PHP)
                  </span>
                  <input
                    required
                    type="number"
                    min="1"
                    value={draft.compareAtPrice}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, compareAtPrice: e.target.value } : d))
                    }
                    placeholder="Upper end of typical jobs"
                    className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  />
                </label>
              ) : pricingKind !== "service" ? (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-foreground">
                    Compare-at (optional)
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={draft.compareAtPrice}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, compareAtPrice: e.target.value } : d))
                    }
                    placeholder="499"
                    className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  />
                </label>
              ) : null}

              {pricingKind !== "service" && (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-foreground">Stock</span>
                  <input
                    type="number"
                    min="0"
                    disabled={editingHasOptions}
                    title={editingHasOptions ? "Set per size/colour in Sizes & colours" : undefined}
                    value={draft.stockQty}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, stockQty: e.target.value } : d))
                    }
                    className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  />
                </label>
              )}
            </div>

            {editingHasOptions && (
              <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                This product has sizes or colours — price and stock are set per variant.{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => {
                    const product = products.find((p) => p.id === editingId);
                    if (product) setVariantsFor(product);
                  }}
                >
                  Edit sizes &amp; colours
                </button>
              </p>
            )}

            {pricingKind !== "service" && !editingHasOptions && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={suggestingPrice || !draft.title.trim()}
                  onClick={() => void handleSuggestPrice()}
                >
                  {suggestingPrice ? "Checking nearby prices…" : "Suggest nearby price"}
                </Button>
                {pricingNote ? (
                  <p className="max-w-xl text-sm text-slate-400">{pricingNote}</p>
                ) : (
                  <p className="text-sm text-slate-400">
                    AI estimates a competitive price for similar products nearby.
                  </p>
                )}
              </div>
            )}

            <label className="block sm:max-w-xs">
              <span className="mb-1 block text-sm font-medium text-foreground">Status</span>
              <select
                value={draft.status}
                onChange={(e) =>
                  setDraft((d) =>
                    d ? { ...d, status: e.target.value as "draft" | "active" } : d
                  )
                }
                className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
              >
                <option value="active">Active (visible on storefront)</option>
                <option value="draft">Draft (hidden)</option>
              </select>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <input
                type="checkbox"
                checked={draft.isMain || (!editingId && products.length === 0)}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, isMain: e.target.checked } : d))
                }
                className="mt-1 h-4 w-4 rounded border-border"
              />
              <span>
                <span className="block text-sm font-semibold text-foreground">
                  Main / identity product
                </span>
                <span className="mt-0.5 block text-xs text-slate-400">
                  Your shop&apos;s signature offering — featured first on the storefront. Only one
                  product can be main.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Save product"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {notice && (
        <p className="mb-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2.5 text-sm text-emerald-100/90">
          {notice}
        </p>
      )}
      {error && !showForm && (
        <p className="mb-4 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-2.5 text-sm text-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-muted-foreground">Loading products…</p>
      ) : products.length === 0 && !showForm ? (
        <Card className="border-dashed border-white/15 bg-white/[0.02]">
          <p className="font-medium text-slate-100">No products yet</p>
          <p className="mt-1 text-sm text-slate-400">
            Add your main identity product first — name, price, and photo. That becomes the face
            of your shop.
          </p>
          <Button type="button" className="mt-4" onClick={openCreateForm}>
            + Add main product
          </Button>
        </Card>
      ) : products.length > 0 ? (
        <div className="space-y-6">
          {(() => {
            const main = products.find((p) => p.isMain) ?? null;
            const catalog = products.filter((p) => !p.isMain);
            return (
              <>
                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
                      Main product
                    </h3>
                    <p className="mt-0.5 text-sm text-slate-400">
                      Your shop&apos;s identity offering — featured first on the storefront.
                    </p>
                  </div>
                  {main ? (
                    <Card className="border-emerald-500/30 bg-emerald-500/5">
                      <div className="flex items-center justify-between gap-4">
                        {main.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={productImageSrc(main.imageUrl)}
                            alt={main.title}
                            className="h-20 w-20 shrink-0 rounded-xl border border-border object-cover"
                          />
                        ) : (
                          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-xs text-slate-500">
                            No photo
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-slate-100">{main.title}</h3>
                            <Badge className="border-emerald-400/30 bg-emerald-400/15 text-emerald-200">
                              Main
                            </Badge>
                            <Badge
                              className={
                                main.status === "active"
                                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                                  : "border-white/10 bg-white/[0.04] text-slate-400"
                              }
                            >
                              {main.status}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-slate-400">
                            {main.hasOptions ? "From " : ""}
                            {priceLineForProduct(main)}
                            {stockLine(main)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          {main.status === "active" && (
                            <a
                              href={`/checkout-links?product=${main.id}`}
                              className="rounded-xl border border-primary/40 px-3 py-1.5 text-sm text-primary transition hover:bg-primary/10"
                            >
                              Checkout link
                            </a>
                          )}
                          {pricingKind !== "service" && (
                            <button
                              type="button"
                              onClick={() => setVariantsFor(main)}
                              className="rounded-xl border border-white/10 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/[0.05]"
                            >
                              {main.hasOptions ? "Sizes & colours" : "Add sizes"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => startEdit(main)}
                            className="rounded-xl border border-white/10 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/[0.05]"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    </Card>
                  ) : (
                    <Card className="border-dashed border-amber-400/25 bg-amber-400/5">
                      <p className="font-medium text-amber-100">No main product yet</p>
                      <p className="mt-1 text-sm text-slate-400">
                        Pick one from your catalog below, or mark a product as main when you save
                        it.
                      </p>
                    </Card>
                  )}
                </section>

                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                      Catalog
                    </h3>
                    <p className="mt-0.5 text-sm text-slate-400">
                      Other products in your shop.
                    </p>
                  </div>
                  {catalog.length === 0 ? (
                    <Card className="border-dashed border-white/10 bg-white/[0.02]">
                      <p className="text-sm text-slate-400">
                        No other products yet. Add more anytime — only one stays main.
                      </p>
                    </Card>
                  ) : (
                    <div className="grid gap-3">
                      {catalog.map((product) => (
                        <Card key={product.id} className="flex items-center justify-between gap-4">
                          {product.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={productImageSrc(product.imageUrl)}
                              alt={product.title}
                              className="h-16 w-16 shrink-0 rounded-xl border border-border object-cover"
                            />
                          ) : (
                            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-xs text-slate-500">
                              No photo
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold text-slate-100">{product.title}</h3>
                              <Badge
                                className={
                                  product.status === "active"
                                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                                    : "border-white/10 bg-white/[0.04] text-slate-400"
                                }
                              >
                                {product.status}
                              </Badge>
                            </div>
                            <p className="mt-1 text-sm text-slate-500">
                              {product.hasOptions ? "From " : ""}
                              {priceLineForProduct(product)}
                              {stockLine(product)} · /
                              {product.slug}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                            {product.status === "active" && (
                              <a
                                href={`/checkout-links?product=${product.id}`}
                                className="rounded-xl border border-primary/40 px-3 py-1.5 text-sm text-primary transition hover:bg-primary/10"
                              >
                                Checkout link
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => void setAsMainProduct(product)}
                              className="rounded-xl border border-emerald-500/30 px-3 py-1.5 text-sm text-emerald-300 transition hover:bg-emerald-500/10"
                            >
                              Set as main
                            </button>
                            {pricingKind !== "service" && (
                              <button
                                type="button"
                                onClick={() => setVariantsFor(product)}
                                className="rounded-xl border border-white/10 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/[0.05]"
                              >
                                {product.hasOptions ? "Sizes & colours" : "Add sizes"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => startEdit(product)}
                              className="rounded-xl border border-white/10 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/[0.05]"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(product)}
                              disabled={deletingId === product.id}
                              className="rounded-xl px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
                            >
                              {deletingId === product.id ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </section>
              </>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
