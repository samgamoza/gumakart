export function formatElectroPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export function electroBrandName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || name;
}

export function electroStarRating(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash + seed.charCodeAt(i)) % 5;
  return Math.max(3, hash + 1);
}

export const ELECTRO_HERO_IMAGES = [
  "https://images.unsplash.com/photo-1498049794561-7780e7231661?w=900&q=80",
  "https://images.unsplash.com/photo-1525547719578-a369d4a4eb2f?w=900&q=80",
];

export const ELECTRO_SIDE_BANNER =
  "https://images.unsplash.com/photo-1468495244123-6c6c332eeece?w=600&q=80";
