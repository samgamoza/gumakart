"use client";

import { shrinkImage } from "@gumakart/ui/shrink-image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, formatPrice } from "@gumakart/ui";
import { ProductVariantsEditor } from "@/components/product-variants-editor";
import { useShopRole } from "@/lib/use-shop-role";
import { CaptionsButton } from "@/components/ai/captions-dialog";
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
  metadataJson?: (ProductPricingMeta & { preorder?: { enabled?: boolean; shipDate?: string } }) | null;
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
  /** Phase 22: pre-order toggle + expected ship date (YYYY-MM-DD). */
  preorderEnabled: boolean;
  preorderShipDate: string;
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
  preorderEnabled: false,
  preorderShipDate: "",
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

/** Inline field message, announced by screen readers and tied to its input via aria-describedby. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} className="mt-1 block text-sm font-medium text-red-600 dark:text-red-300">
      {message}
    </span>
  );
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
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [photoChecks, setPhotoChecks] = useState<string[]>([]);
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
  // Field-level problems shown next to the field (the summary at the top says how many).
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"title" | "basePrice" | "compareAtPrice" | "unitCustom" | "preorderShipDate", string>>>({});
  // After a new product is saved: point the seller at the next useful step (share it).
  const [justCreated, setJustCreated] = useState<{ id: string | null; title: string; active: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const perms = useShopRole();
  const canEdit = perms.can("products.edit");
  const canMarket = perms.can("marketing.manage");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [productsRes, shopRes] = await Promise.all([
        fetch("/api/products"),
        fetch("/api/shop"),
      ]);
      const productsData = await productsRes.json();
      const shopData = await shopRes.json().catch(() => ({ ok: false }));
      if (productsData.ok) setProducts(productsData.products);
      else setLoadError(productsData.error ?? "We couldn't load your products.");
      if (shopData.ok) {
        setShop({
          name: shopData.shop.tenant.name,
          category: shopData.shop.tenant.category,
        });
      }
    } catch {
      setLoadError("We couldn't reach GumaKart. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Deep link from Home's setup checklist: /products?new=1 opens the form straight away.
  useEffect(() => {
    if (loading || !canEdit) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1" && !showForm) {
      openCreateForm();
      params.delete("new");
      const qs = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, canEdit]);

  /** Focus the first field with a problem so keyboard and screen-reader users land on it. */
  function focusField(name: string) {
    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-field="${name}"]`);
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

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
    setFieldErrors({});
    setJustCreated(null);
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
    setFieldErrors({});
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
    setFieldErrors({});
    setJustCreated(null);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      preorderEnabled: product.metadataJson?.preorder?.enabled === true,
      preorderShipDate: product.metadataJson?.preorder?.shipDate ?? "",
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
    setError(null);
    setUploadingImage(true);
    // Phase 20: shrink in the browser first (big phone photos become ~200–400 KB WebP).
    file = await shrinkImage(file);
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      setUploadingImage(false);
      setError("Image must be 5 MB or smaller.");
      return;
    }

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

  /** Phase 33 (H2): photo → draft name and description, for the seller to review. */
  async function handleFromPhoto() {
    if (!draft?.imageUrl) return;
    setError(null);
    setDescriptionNote(null);
    setReadingPhoto(true);
    try {
      const res = await fetch("/api/products/from-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: originalImageUrl ?? draft.imageUrl, hint: draft.title.trim() || undefined }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Could not read the photo.");
        return;
      }
      const listing = data.listing as { title: string; description: string; checks: string[] };
      setDraft((current) =>
        current
          ? {
              ...current,
              title: listing.title,
              descriptionHtml: plainDescriptionToHtml(listing.description),
            }
          : current
      );
      setPhotoChecks(listing.checks ?? []);
      setDescriptionNote("AI wrote this from your photo — check the details, then set your price.");
    } catch {
      setError("Network error while reading the photo.");
    } finally {
      setReadingPhoto(false);
    }
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

    const price = Number(draft.basePrice);
    const compareAt = draft.compareAtPrice ? Number(draft.compareAtPrice) : null;
    // Check every field at once so the seller sees all problems in one go; their input stays as typed.
    const problems: typeof fieldErrors = {};
    if (!draft.title.trim()) problems.title = "Give the product a name buyers will recognise.";
    if (!editingHasOptions && (!draft.basePrice.trim() || !Number.isFinite(price) || price <= 0)) {
      problems.basePrice = "Enter a price above ₱0, e.g. 325.";
    }
    if (
      pricingKind === "service" &&
      draft.servicePriceStyle === "value_range" &&
      (!compareAt || compareAt < price)
    ) {
      problems.compareAtPrice = "The maximum should be at least the minimum.";
    }
    if (pricingKind === "food" && draft.unitType === "other" && !draft.unitCustom.trim()) {
      problems.unitCustom = "Say how it's sold, e.g. per tray or per kilo.";
    }
    if (draft.preorderEnabled && !/^\d{4}-\d{2}-\d{2}$/.test(draft.preorderShipDate)) {
      problems.preorderShipDate = "Pick the date you expect to ship pre-orders.";
    }
    setFieldErrors(problems);
    const firstProblem = Object.keys(problems)[0];
    if (firstProblem) {
      const count = Object.keys(problems).length;
      setError(count === 1 ? "Please fix the field marked below." : `Please fix the ${count} fields marked below.`);
      if (firstProblem === "preorderShipDate" || (firstProblem === "compareAtPrice" && pricingKind !== "service")) {
        setShowMoreOptions(true);
      }
      focusField(firstProblem);
      return;
    }

    setSaving(true);
    // Phase 22: the pre-order setting rides along with the pricing metadata.
    const pricingMeta = buildPricingMeta(draft);
    const metadataJson =
      draft.preorderEnabled || draft.preorderShipDate
        ? { ...(pricingMeta ?? {}), preorder: { enabled: draft.preorderEnabled, ...(draft.preorderShipDate ? { shipDate: draft.preorderShipDate } : {}) } }
        : pricingMeta;
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
        }).catch(() => null)
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
        }).catch(() => null);

    const data = res ? await res.json().catch(() => ({ ok: false, error: null })) : { ok: false, error: null };
    setSaving(false);

    if (!data.ok) {
      // Keep everything the seller typed; tell them what happened and how to recover.
      setError(
        data.error
          ? `${data.error} Your details are still here — fix it and save again.`
          : "We couldn't save just now. Your details are still here — check your connection and tap Save again."
      );
      return;
    }

    const wasNew = !editingId;
    const savedTitle = draft.title.trim();
    const savedActive = draft.status === "active";
    closeCreateForm();
    if (wasNew) {
      setJustCreated({ id: data.product?.id ?? null, title: savedTitle, active: savedActive });
    } else {
      setNotice(`Saved changes to ${savedTitle}.`);
    }
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
              : "Add what you sell — a name and price is enough to start."}
          </p>
        </div>
        {showForm ? null : canEdit ? (
          <Button type="button" onClick={openCreateForm} className="min-h-[44px]">
            + Add product
          </Button>
        ) : (
          <span className="text-xs text-slate-400">View only — ask a manager to change products.</span>
        )}
      </div>

      {showForm && draft && (
        <Card className="mb-6 border-white/10 bg-white/[0.03]">
          <div className="mb-5">
            <h3 className="font-semibold text-slate-100">
              {editingId ? "Edit product" : "New product"}
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Name and price are all you need. Add a photo if you have one — AI can draft the
              description from it. Price and stock are always yours.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {changeRequestId && requiresReview && (
              <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100/90">
                An AI suggestion is tracked as a change request. Saving applies it to your catalog.
              </p>
            )}

            {error && (
              <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-800 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200">
                {error}
              </div>
            )}

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-foreground">Product name</span>
              <input
                data-field="title"
                required
                aria-invalid={fieldErrors.title ? true : undefined}
                aria-describedby={fieldErrors.title ? "err-title" : undefined}
                value={draft.title}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft((d) => (d ? { ...d, title: value } : d));
                  if (fieldErrors.title && value.trim()) setFieldErrors((f) => ({ ...f, title: undefined }));
                }}
                className={`h-11 w-full rounded-xl border bg-card px-3 text-base sm:text-sm ${fieldErrors.title ? "border-red-500" : "border-border"}`}
                placeholder="e.g. Ube Halaya 500g"
                autoComplete="off"
              />
              <FieldError id="err-title" message={fieldErrors.title} />
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
                      aria-pressed={draft.unitType === id}
                      className={`min-h-[40px] rounded-full border px-3 py-1.5 text-sm font-medium ${
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
                    data-field="unitCustom"
                    aria-label="How it's sold"
                    aria-invalid={fieldErrors.unitCustom ? true : undefined}
                    aria-describedby={fieldErrors.unitCustom ? "err-unitCustom" : undefined}
                    value={draft.unitCustom}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, unitCustom: e.target.value } : d))
                    }
                    placeholder="e.g. per tray, per kilo, per dozen"
                    className="mt-1 h-11 w-full max-w-md rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-slate-500"
                  />
                )}
                <FieldError id="err-unitCustom" message={fieldErrors.unitCustom} />
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
                      aria-pressed={draft.servicePriceStyle === id}
                      className={`min-h-[40px] rounded-full border px-3 py-1.5 text-sm font-medium ${
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
                pricingKind === "service" ? "sm:max-w-md sm:grid-cols-2" : "grid-cols-2 sm:max-w-md"
              }`}
            >
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-foreground">
                  {pricingKind === "service"
                    ? draft.servicePriceStyle === "value_range"
                      ? "Minimum (₱)"
                      : "Base / minimum (₱)"
                    : pricingKind === "food"
                      ? `Price (₱)${
                          draft.unitType === "pc"
                            ? " · per pc"
                            : draft.unitType === "box"
                              ? " · per box"
                              : draft.unitCustom.trim()
                                ? ` · per ${draft.unitCustom.trim()}`
                                : ""
                        }`
                      : "Price (₱)"}
                </span>
                <input
                  data-field="basePrice"
                  required
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="any"
                  disabled={editingHasOptions}
                  title={editingHasOptions ? "Set per size/colour in Sizes & colours" : undefined}
                  aria-invalid={fieldErrors.basePrice ? true : undefined}
                  aria-describedby={fieldErrors.basePrice ? "err-basePrice" : undefined}
                  value={draft.basePrice}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDraft((d) => (d ? { ...d, basePrice: value } : d));
                    if (fieldErrors.basePrice && Number(value) > 0) setFieldErrors((f) => ({ ...f, basePrice: undefined }));
                  }}
                  placeholder="325"
                  className={`h-11 w-full rounded-xl border bg-card px-3 text-base sm:text-sm ${fieldErrors.basePrice ? "border-red-500" : "border-border"}`}
                />
                <FieldError id="err-basePrice" message={fieldErrors.basePrice} />
              </label>

              {pricingKind === "service" && draft.servicePriceStyle === "value_range" ? (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-foreground">
                    Maximum (₱)
                  </span>
                  <input
                    data-field="compareAtPrice"
                    required
                    type="number"
                    inputMode="decimal"
                    min="1"
                    aria-invalid={fieldErrors.compareAtPrice ? true : undefined}
                    aria-describedby={fieldErrors.compareAtPrice ? "err-compareAtPrice" : undefined}
                    value={draft.compareAtPrice}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, compareAtPrice: e.target.value } : d))
                    }
                    placeholder="Upper end of typical jobs"
                    className={`h-11 w-full rounded-xl border bg-card px-3 text-base sm:text-sm ${fieldErrors.compareAtPrice ? "border-red-500" : "border-border"}`}
                  />
                  <FieldError id="err-compareAtPrice" message={fieldErrors.compareAtPrice} />
                </label>
              ) : null}

              {pricingKind !== "service" && (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-foreground">In stock</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    disabled={editingHasOptions}
                    title={editingHasOptions ? "Set per size/colour in Sizes & colours" : undefined}
                    aria-describedby="hint-stock"
                    value={draft.stockQty}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, stockQty: e.target.value } : d))
                    }
                    placeholder="0"
                    className="h-11 w-full rounded-xl border bg-card px-3 text-base sm:text-sm border-border"
                  />
                  <span id="hint-stock" className="mt-1 block text-xs text-slate-500">
                    Orders stop at 0 unless you take pre-orders.
                  </span>
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

            <div className="rounded-xl border border-border bg-card p-4">
              <span className="mb-2 block text-sm font-medium text-foreground">
                Photo <span className="font-normal text-slate-500">(optional, but buyers trust a real photo)</span>
              </span>
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
                        <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-violet-600">
                          Replace photo
                          <input
                            type="file"
                            accept={PRODUCT_IMAGE_ACCEPT}
                            className="sr-only"
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
                          Remove background
                        </p>
                        <p className="text-xs text-slate-500">
                          Cuts out your product and places it on a clean white background. Uses 1 AI generation.
                        </p>
                      </div>
                      <Button type="button" onClick={handleEnhancePhoto} disabled={enhancing}>
                        {enhancing
                          ? "Removing… (first run may take a minute)"
                          : "Remove background"}
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4" data-testid="from-photo">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-200">Write the listing from this photo (AI)</p>
                        <p className="text-xs text-slate-500">
                          Fills the name and description for you to check. Price and stock stay yours. Uses 1 AI generation.
                        </p>
                      </div>
                      <Button type="button" onClick={() => void handleFromPhoto()} disabled={readingPhoto}>
                        {readingPhoto ? "Reading photo…" : "Fill from photo"}
                      </Button>
                    </div>
                    {photoChecks.length > 0 && (
                      <p className="mt-2 text-xs text-amber-300" data-testid="from-photo-checks">
                        Please fill in: {photoChecks.join(", ")}.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <label
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-violet-600 ${
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
                    className="sr-only"
                    onChange={handleImageSelect}
                    disabled={uploadingImage}
                  />
                  <span className="text-sm font-medium text-slate-200">
                    {uploadingImage
                      ? "Uploading…"
                      : dragOverPhoto
                        ? "Drop photo to upload"
                        : "Tap to add a photo, or drag one here"}
                  </span>
                  <span className="mt-1 text-xs text-slate-400">
                    JPG, PNG, WebP, GIF, or AVIF · up to 5 MB
                  </span>
                </label>
              )}
            </div>

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


            <div className="rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setShowMoreOptions((v) => !v)}
                aria-expanded={showMoreOptions}
                aria-controls="product-more-options"
                className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left"
              >
                <span>
                  <span className="block text-sm font-semibold text-foreground">More options</span>
                  <span className="block text-xs text-slate-500">
                    {pricingKind === "service"
                      ? "Visibility, main product, nearby price check"
                      : "Sale price, pre-orders, visibility, main product, nearby price check"}
                  </span>
                </span>
                <span aria-hidden className={`text-slate-500 transition-transform ${showMoreOptions ? "rotate-180" : ""}`}>▾</span>
              </button>
              {showMoreOptions && (
                <div id="product-more-options" className="space-y-4 border-t border-border px-4 py-4">
                  {pricingKind !== "service" && (
                    <label className="block sm:max-w-xs">
                      <span className="mb-1 block text-sm font-medium text-foreground">
                        Original price before sale (₱, optional)
                      </span>
                      <input
                        data-field="compareAtPrice"
                        type="number"
                        inputMode="decimal"
                        min="1"
                        aria-describedby="hint-compare"
                        value={draft.compareAtPrice}
                        onChange={(e) =>
                          setDraft((d) => (d ? { ...d, compareAtPrice: e.target.value } : d))
                        }
                        placeholder="e.g. 399"
                        className="h-11 w-full rounded-xl border bg-card px-3 text-base sm:text-sm border-border"
                      />
                      <span id="hint-compare" className="mt-1 block text-xs text-slate-500">
                        Shown crossed out next to your price. Leave empty if there&apos;s no sale.
                      </span>
                    </label>
                  )}

                  {pricingKind !== "service" && (
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4" data-testid="preorder-settings">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4"
                          checked={draft.preorderEnabled}
                          onChange={(e) => setDraft((d) => (d ? { ...d, preorderEnabled: e.target.checked } : d))}
                          data-testid="preorder-enabled"
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-200">Take pre-orders</span>
                          <span className="block text-xs text-slate-500">
                            Buyers can order even with 0 stock; the order shows &quot;Pre-order — ships ~date&quot;. Pre-orders don&apos;t take
                            stock. It turns off by itself after the ship date.
                          </span>
                        </span>
                      </label>
                      {draft.preorderEnabled && (
                        <label className="mt-3 block max-w-xs">
                          <span className="mb-1 block text-xs font-medium text-slate-300">Expected ship date</span>
                          <input
                            data-field="preorderShipDate"
                            type="date"
                            min={new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)}
                            aria-invalid={fieldErrors.preorderShipDate ? true : undefined}
                            aria-describedby={fieldErrors.preorderShipDate ? "err-preorderShipDate" : undefined}
                            value={draft.preorderShipDate}
                            onChange={(e) => setDraft((d) => (d ? { ...d, preorderShipDate: e.target.value } : d))}
                            className={`h-11 w-full rounded-xl border bg-card px-3 text-sm ${fieldErrors.preorderShipDate ? "border-red-500" : "border-border"}`}
                            data-testid="preorder-date"
                          />
                          <FieldError id="err-preorderShipDate" message={fieldErrors.preorderShipDate} />
                        </label>
                      )}
                    </div>
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
                    <span className="mb-1 block text-sm font-medium text-foreground">Who can see it</span>
                    <select
                      value={draft.status}
                      onChange={(e) =>
                        setDraft((d) =>
                          d ? { ...d, status: e.target.value as "draft" | "active" } : d
                        )
                      }
                      className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                    >
                      <option value="active">Live — buyers can order it</option>
                      <option value="draft">Hidden — only you can see it</option>
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
                        Feature this as my main product
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-400">
                        Shown first on your online store. Only one product can be main.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>

            <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-1 flex flex-wrap gap-2 rounded-xl bg-card/95 px-1 py-2 backdrop-blur lg:static lg:bg-transparent lg:p-0 lg:pt-1">
              <Button type="submit" disabled={saving} className="min-h-[44px] flex-1 sm:flex-none">
                {saving ? "Saving…" : editingId ? "Save changes" : "Save product"}
              </Button>
              <Button type="button" variant="secondary" onClick={closeCreateForm} className="min-h-[44px]">
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {justCreated && !showForm && (
        <div
          role="status"
          className="gk-rise mb-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-400/25 dark:bg-emerald-500/10"
        >
          <p className="font-semibold text-emerald-900 dark:text-emerald-100">
            {justCreated.title} is saved.
          </p>
          <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200/90">
            {justCreated.active
              ? "Next: make a checkout link and paste it in your post or chat — buyers order on one page."
              : "It's hidden for now. Set it to Live under More options when you're ready to sell it."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {justCreated.active && justCreated.id ? (
              <a
                href={`/checkout-links?product=${justCreated.id}`}
                className="inline-flex min-h-[44px] items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700"
              >
                Make a checkout link
              </a>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                onClick={openCreateForm}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-emerald-300 px-4 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 dark:border-emerald-400/30 dark:text-emerald-100 dark:hover:bg-emerald-500/10"
              >
                Add another product
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setJustCreated(null)}
              className="inline-flex min-h-[44px] items-center rounded-xl px-3 text-sm text-emerald-800 hover:underline dark:text-emerald-200"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100/90">
          {notice}
        </p>
      )}
      {error && !showForm && (
        <p role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading products">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex animate-pulse items-center gap-4 rounded-2xl border border-border bg-card p-4">
              <div className="h-16 w-16 rounded-xl bg-slate-200 dark:bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-white/10" />
                <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError && products.length === 0 ? (
        <Card className="border-red-200 dark:border-red-400/20">
          <p className="font-medium text-slate-900 dark:text-slate-100">Products didn&apos;t load</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{loadError}</p>
          <Button type="button" variant="secondary" className="mt-4 min-h-[44px]" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      ) : products.length === 0 && !showForm && !justCreated ? (
        <Card className="border-dashed border-white/15 bg-white/[0.02] text-center sm:text-left">
          <p className="font-medium text-slate-100">Add your first product</p>
          <p className="mt-1 text-sm text-slate-400">
            Just a name and a price — photo optional. Then you can share it with a checkout link in
            your posts and chats.
          </p>
          {canEdit ? (
            <Button type="button" className="mt-4 min-h-[44px]" onClick={openCreateForm}>
              + Add product
            </Button>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Ask the shop owner or a manager to add products.</p>
          )}
        </Card>
      ) : products.length > 0 ? (
        <div className="space-y-6">
          {(() => {
            const main = products.find((p) => p.isMain) ?? null;
            const catalog = products.filter((p) => !p.isMain);
            return (
              <>
                {main ? (
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
                      <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap">
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
                              {main.status === "active" ? "Live" : "Hidden"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-slate-400">
                            {main.hasOptions ? "From " : ""}
                            {priceLineForProduct(main)}
                            {stockLine(main)}
                          </p>
                        </div>
                        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0 sm:justify-end">
                          {main.status === "active" && (
                            <a
                              href={`/checkout-links?product=${main.id}`}
                              aria-label={`Make a checkout link for ${main.title}`}
                              className="rounded-xl border border-primary/40 inline-flex min-h-[40px] items-center px-3 py-1.5 text-sm text-primary transition hover:bg-primary/10"
                            >
                              Share link
                            </a>
                          )}
                          {pricingKind !== "service" && canEdit && (
                            <button
                              type="button"
                              onClick={() => setVariantsFor(main)}
                              className="rounded-xl border border-white/10 inline-flex min-h-[40px] items-center px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/[0.05]"
                            >
                              {main.hasOptions ? "Sizes & colours" : "Add sizes"}
                            </button>
                          )}
                          {canMarket && main.status === "active" && (
                            <CaptionsButton productId={main.id} title={main.title} className="inline-flex items-center gap-1 rounded-xl border border-violet-400/30 inline-flex min-h-[40px] items-center px-3 py-1.5 text-sm text-violet-200 transition hover:bg-violet-500/10" />
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => startEdit(main)}
                              aria-label={`Edit ${main.title}`}
                              className="rounded-xl border border-white/10 inline-flex min-h-[40px] items-center px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/[0.05]"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </div>
                    </Card>
                  ) : null}
                </section>
                ) : null}

                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                      {main ? "Other products" : "Your products"}
                    </h3>
                    <p className="mt-0.5 text-sm text-slate-400">
                      Tap Share link to sell one in a post or chat.
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
                        <Card key={product.id} className="flex flex-wrap items-center gap-4 sm:flex-nowrap">
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
                                {product.status === "active" ? "Live" : "Hidden"}
                              </Badge>
                            </div>
                            <p className="mt-1 text-sm text-slate-500">
                              {product.hasOptions ? "From " : ""}
                              {priceLineForProduct(product)}
                              {stockLine(product)}
                            </p>
                          </div>
                          <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0 sm:justify-end">
                            {product.status === "active" && (
                              <a
                                href={`/checkout-links?product=${product.id}`}
                              aria-label={`Make a checkout link for ${product.title}`}
                                className="rounded-xl border border-primary/40 inline-flex min-h-[40px] items-center px-3 py-1.5 text-sm text-primary transition hover:bg-primary/10"
                              >
                                Share link
                              </a>
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => void setAsMainProduct(product)}
                                className="rounded-xl border border-emerald-500/30 inline-flex min-h-[40px] items-center px-3 py-1.5 text-sm text-emerald-300 transition hover:bg-emerald-500/10"
                              >
                                Set as main
                              </button>
                            )}
                            {pricingKind !== "service" && canEdit && (
                              <button
                                type="button"
                                onClick={() => setVariantsFor(product)}
                                className="rounded-xl border border-white/10 inline-flex min-h-[40px] items-center px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/[0.05]"
                              >
                                {product.hasOptions ? "Sizes & colours" : "Add sizes"}
                              </button>
                            )}
                            {canMarket && product.status === "active" && (
                              <CaptionsButton productId={product.id} title={product.title} className="inline-flex items-center gap-1 rounded-xl border border-violet-400/30 inline-flex min-h-[40px] items-center px-3 py-1.5 text-sm text-violet-200 transition hover:bg-violet-500/10" />
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => startEdit(product)}
                              aria-label={`Edit ${product.title}`}
                                className="rounded-xl border border-white/10 inline-flex min-h-[40px] items-center px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/[0.05]"
                              >
                                Edit
                              </button>
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => handleDelete(product)}
                                aria-label={`Delete ${product.title}`}
                                disabled={deletingId === product.id}
                                className="rounded-xl inline-flex min-h-[40px] items-center px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
                              >
                                {deletingId === product.id ? "Deleting…" : "Delete"}
                              </button>
                            )}
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
