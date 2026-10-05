export function formatFurnishPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

/** Two-line uppercase brand like Furnish template logo. */
export function furnishBrandLines(name: string, tagline?: string): { line1: string; line2: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return { line1: parts[0]!.toUpperCase(), line2: tagline?.slice(0, 24).toUpperCase() || "HOME" };
  }
  return {
    line1: parts[0]!.toUpperCase(),
    line2: parts.slice(1).join(" ").toUpperCase(),
  };
}

export function discountLabel(price: number, compareAt?: number): string | null {
  if (!compareAt || compareAt <= price) return null;
  const pct = Math.round(((compareAt - price) / compareAt) * 100);
  return `${pct}% OFF`;
}
