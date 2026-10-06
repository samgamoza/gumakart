import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Headphones, ShieldCheck, Tag, Truck } from "lucide-react";
import type { DemoProduct, DemoTenant } from "@/lib/demo-data";
import { solidCtaColor } from "@/lib/color-contrast";
import { formatPhpMoney, productCardPricing } from "@/lib/product-price-display";
import { adminUrl } from "@/lib/utils";
import { resolveCommerceChrome } from "@gumakart/storefront-themes";
import { AddToCartButton } from "./add-to-cart";
import { ShopifyRelatedProducts } from "./shopify-catalog";
import { RatingStars } from "@/components/rating-stars";

export function ShopifyProductStage({
  tenant,
  product,
}: {
  tenant: DemoTenant;
  product: DemoProduct;
}) {
  const accent = solidCtaColor(
    tenant.shopTheme?.primaryColor ?? tenant.theme.primaryColor,
    "#0f172a"
  );
  const breadcrumb = `${tenant.name.toUpperCase()} › ${(product.category || tenant.category).toUpperCase()}`;
  const chrome = resolveCommerceChrome(tenant.category);
  const SecondaryIcon = chrome.mode === "service" ? Headphones : Truck;
  const pricing = productCardPricing(tenant.category, product, formatPhpMoney);

  const detailRows: Array<{ label: string; value: string }> = [
    { label: "Shop", value: tenant.name },
    { label: "Category", value: product.category || tenant.category },
    {
      label: "Listing type",
      value:
        pricing.kind === "service"
          ? "Service"
          : pricing.kind === "food"
            ? "Food item"
            : "Product",
    },
    {
      label: pricing.kind === "service" ? "Service value" : "Price",
      value: pricing.priceLine,
    },
  ];
  if (pricing.priceCaption) {
    detailRows.push({ label: "Pricing note", value: pricing.priceCaption });
  }
  if (product.isMain) {
    detailRows.push({ label: "Highlight", value: "Main / identity listing" });
  }

  return (
    <>
      <div className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <Link
            href={`/${tenant.slug}`}
            className="inline-flex items-center gap-2 text-sm font-medium text-neutral-600 transition hover:text-neutral-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to shop
          </Link>
          <Link
            href={`${adminUrl}/products`}
            className="hidden rounded-full border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 sm:inline-flex"
          >
            Edit product
          </Link>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
        <div className="grid gap-8 md:grid-cols-2 md:gap-12 lg:gap-16">
          <div className="space-y-3">
            <div className="relative aspect-square overflow-hidden rounded-3xl bg-neutral-100 ring-1 ring-neutral-200/80">
              <Image
                src={product.image}
                alt={product.title}
                fill
                className="object-cover"
                priority
                sizes="(max-width: 768px) 100vw, 50vw"
              />
            </div>
            <p className="text-center text-xs text-neutral-500 md:text-left">
              Full product photo — tap image area on mobile to review quality before ordering.
            </p>
          </div>

          <div className="flex flex-col justify-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
              {breadcrumb}
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight md:text-4xl lg:text-5xl">
              {product.title}
            </h1>
            {product.rating ? (
              <a href="#reviews" className="mt-2 inline-block text-neutral-600 hover:underline">
                <RatingStars rating={product.rating} size="md" />
              </a>
            ) : null}

            <div className="mt-4 flex flex-wrap items-baseline gap-3">
              <span className="text-2xl font-semibold md:text-3xl">
                {product.variants && new Set(product.variants.map((v) => v.price)).size > 1 ? "From " : ""}
                {pricing.priceLine}
              </span>
              {pricing.compareAtLine && (
                <span className="text-lg text-neutral-400 line-through">{pricing.compareAtLine}</span>
              )}
              {pricing.priceCaption && (
                <span className="text-sm font-medium text-neutral-500">{pricing.priceCaption}</span>
              )}
            </div>

            <p className="mt-6 text-base leading-relaxed text-neutral-600 md:text-lg">
              {product.shortDescription ||
                (pricing.kind === "service"
                  ? "Ask the seller for a quote or schedule based on your device and issue."
                  : "Product details from the seller.")}
            </p>

            <AddToCartButton
              tenantSlug={tenant.slug}
              product={product}
              accent={accent}
              category={tenant.category}
            />

            <div className="mt-6 flex flex-wrap gap-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                {chrome.trustPrimary}
              </span>
              <span className="inline-flex items-center gap-2">
                <SecondaryIcon className="h-4 w-4" />
                {chrome.trustSecondary}
              </span>
            </div>
          </div>
        </div>

        <section className="mt-12 rounded-3xl border border-neutral-200 bg-neutral-50/70 p-6 md:mt-16 md:p-8">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-neutral-500" />
            <h2 className="font-display text-xl font-bold tracking-tight">Product details</h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            Specs and listing info from the seller — similar to marketplace product pages.
          </p>
          <dl className="mt-6 grid gap-3 sm:grid-cols-2">
            {detailRows.map((row) => (
              <div
                key={row.label}
                className="rounded-2xl border border-neutral-200 bg-white px-4 py-3"
              >
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                  {row.label}
                </dt>
                <dd className="mt-1 text-sm font-medium text-neutral-900">{row.value}</dd>
              </div>
            ))}
          </dl>
          {product.shortDescription ? (
            <div className="mt-6 border-t border-neutral-200 pt-6">
              <h3 className="text-sm font-semibold text-neutral-900">About this listing</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-600">
                {product.shortDescription}
              </p>
            </div>
          ) : null}
        </section>
      </main>

      <ShopifyRelatedProducts tenant={tenant} currentProductId={product.id} />
    </>
  );
}
