import { inDiscountWindow, type TenantCheckoutJson } from "@gumakart/db";

/**
 * Phase 14: tell buyers about live deals on the product page (Taglish). Quantity deals that
 * cover this product, and the automatic order discount. Checkout applies them by itself.
 */
export function DealsBanner({ checkout, productId }: { checkout: TenantCheckoutJson | null; productId: string }) {
  if (!checkout) return null;
  const now = new Date();
  const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, "")}`;
  const lines: string[] = [];
  for (const d of checkout.volumeDiscounts ?? []) {
    if (d.active === false || !inDiscountWindow(d, now)) continue;
    if (d.productIds.length && !d.productIds.includes(productId)) continue;
    lines.push(
      `${d.label}: bumili ng ${d.minQty} o higit pa${d.productIds.length ? "" : " (kahit anong item)"} — ${d.type === "percent" ? `${d.value}% off` : `${peso(d.value)} off bawat isa`}`
    );
  }
  const auto = checkout.automaticDiscount;
  if (auto && inDiscountWindow(auto, now)) {
    lines.push(`${auto.label || "Sale"}: ${auto.type === "percent" ? `${auto.value}% off` : `${peso(auto.value)} off`}${auto.minSubtotal ? ` sa orders na ${peso(auto.minSubtotal)} pataas` : ""}`);
  }
  if (lines.length === 0) return null;
  return (
    <div className="mx-auto mt-3 max-w-6xl px-4" data-testid="deals-banner">
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-900 dark:text-emerald-100">
        {lines.slice(0, 3).map((l) => (
          <p key={l}>🎉 {l}</p>
        ))}
        <p className="text-xs opacity-80">Automatic na sa checkout.</p>
      </div>
    </div>
  );
}
