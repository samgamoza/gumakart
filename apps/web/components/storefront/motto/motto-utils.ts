export function formatMottoPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export function mottoBrandName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Motto";
  return trimmed.toUpperCase();
}

export function mottoStarRating(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash + seed.charCodeAt(i)) % 5;
  return Math.max(3, hash + 1);
}

export const MOTTO_HERO_IMAGES = [
  "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=900&q=80",
  "https://images.unsplash.com/photo-1449426468159-d73eba788e00?w=900&q=80",
];

export const MOTTO_FEATURE_STRIP = [
  { id: "helmets", label: "Helmets", desc: "DOT & ECE certified" },
  { id: "jackets", label: "Riding Jackets", desc: "All-weather protection" },
  { id: "gloves", label: "Gloves & Boots", desc: "Grip and control" },
  { id: "parts", label: "Parts & Gear", desc: "OEM-fit accessories" },
] as const;
