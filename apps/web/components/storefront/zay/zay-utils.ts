export function formatZayPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

/** Short brand mark — first word bold green like Zay template. */
export function zayBrandMark(name: string): { primary: string; rest: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { primary: parts[0]!, rest: "Shop" };
  return { primary: parts[0]!, rest: parts.slice(1).join(" ") };
}

export const ZAY_CATEGORY_IMAGES = [
  "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80",
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&q=80",
  "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=400&q=80",
];

export const ZAY_HERO_IMAGES = [
  "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80",
  "https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=800&q=80",
  "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&q=80",
];
