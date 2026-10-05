export function formatFoodmartPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export function foodmartDiscount(price: number, compareAt?: number): string | null {
  if (!compareAt || compareAt <= price) return null;
  const pct = Math.round(((compareAt - price) / compareAt) * 100);
  return `-${pct}%`;
}

export function foodmartStarRating(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash + seed.charCodeAt(i)) % 5;
  const stars = Math.max(4, hash + 1);
  return `${stars}.0`;
}

export const FOODMART_CATEGORY_EMOJI = ["🥦", "🍞", "🥤", "🍷", "🍗", "🌾"];

export const FOODMART_HERO_IMAGES = [
  "https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&q=80",
  "https://images.unsplash.com/photo-1610832958506-aa56368176af?w=800&q=80",
];
