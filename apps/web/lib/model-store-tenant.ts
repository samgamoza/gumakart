import { getShopTemplate } from "@gumakart/storefront-themes";
import type { DemoProduct, DemoTenant } from "@/lib/demo-data";
import { DEFAULT_STOREFRONT_SETTINGS } from "@/lib/storefront-settings";

/** Canonical flagship showcase — marketing “Try live demo” + `/model`. */
export const MODEL_STORE_SLUG = "model";

const SWEET = getShopTemplate("simply-sweet");

/** Curated dessert menu — real food photography, not marketplace filler. */
const FLAGSHIP_PRODUCTS: DemoProduct[] = [
  {
    id: "hq-premium",
    slug: "premium-halo-halo",
    title: "Premium Halo-Halo",
    shortDescription: "Ube halaya, leche flan, macapuno, ice cream — loaded the QC way.",
    price: 149,
    compareAtPrice: 179,
    image: "https://images.unsplash.com/photo-1763469025474-3a70aa986354?w=800&q=80",
    category: "Best Sellers",
    categorySlug: "best-sellers",
    tags: ["bestseller"],
  },
  {
    id: "hq-mango",
    slug: "mango-graham-shake",
    title: "Mango Graham Shake",
    shortDescription: "Carabao mango, crushed graham, condensed milk — TikTok favorite.",
    price: 119,
    compareAtPrice: 139,
    image: "https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?w=800&q=80",
    category: "Shakes",
    categorySlug: "shakes",
    tags: ["deal", "new"],
  },
  {
    id: "hq-ube",
    slug: "ube-special",
    title: "Ube Special Halo-Halo",
    shortDescription: "Double ube, purple yam ice cream, toasted coco — for ube lovers.",
    price: 169,
    compareAtPrice: 199,
    image: "https://images.unsplash.com/photo-1516559828984-fb3b99548b21?w=800&q=80",
    category: "Best Sellers",
    categorySlug: "best-sellers",
    tags: ["bestseller", "deal"],
  },
  {
    id: "hq-bucket",
    slug: "family-bucket",
    title: "Barkada Bucket (4 cups)",
    shortDescription: "Four premium cups, shared spoons energy. Perfect for gabi sessions.",
    price: 499,
    compareAtPrice: 596,
    image: "https://images.unsplash.com/photo-1768204045978-15bb4797f29c?w=800&q=80",
    category: "Bundles",
    categorySlug: "bundles",
    tags: ["deal", "bestseller"],
  },
  {
    id: "hq-mais",
    slug: "mais-con-yelo",
    title: "Mais Con Yelo",
    shortDescription: "Sweet corn, shaved ice, evaporated milk — classic merienda.",
    price: 99,
    image: "https://images.unsplash.com/photo-1646318754907-dc7c0d236a97?w=800&q=80",
    category: "Classics",
    categorySlug: "classics",
    tags: [],
  },
  {
    id: "hq-leche",
    slug: "leche-flan-cup",
    title: "Leche Flan Cup",
    shortDescription: "Silky caramel custard, chilled and ready for same-day delivery.",
    price: 89,
    compareAtPrice: 109,
    image: "https://images.unsplash.com/photo-1653988354010-39637252a2db?w=800&q=80",
    category: "Classics",
    categorySlug: "classics",
    tags: ["new"],
  },
  {
    id: "hq-biko",
    slug: "ube-biko-box",
    title: "Ube Biko Box",
    shortDescription: "Sticky rice + ube jam, 4 slices. Pasalubong-ready packaging.",
    price: 249,
    image: "https://images.unsplash.com/photo-1566901889590-85481ae4de50?w=800&q=80",
    category: "Bundles",
    categorySlug: "bundles",
    tags: ["new"],
  },
  {
    id: "hq-avocado",
    slug: "avocado-shake",
    title: "Avocado Milkshake",
    shortDescription: "Ripe avocado, milk, a touch of sugar — thick and cold.",
    price: 129,
    image: "https://images.unsplash.com/photo-1768723228817-7902ab347f5d?w=800&q=80",
    category: "Shakes",
    categorySlug: "shakes",
    tags: [],
  },
];

/**
 * Flagship model store: Halo Queen Manila on the Simply Sweet kitchen renderer.
 * Matches the marketing hero story and shows Pro/Advance-tier polish.
 */
export function getModelStoreTenant(slug: string = MODEL_STORE_SLUG): DemoTenant {
  const primary = "#059669";
  const accent = "#f59e0b";

  return {
    slug,
    name: "Halo Queen Manila",
    tagline: "Premium halo-halo & shakes, delivered ice-cold across Metro Manila.",
    category: "Food & Beverage",
    location: "Quezon City · Metro Manila",
    logoEmoji: "🍧",
    coverUrl:
      "https://images.unsplash.com/photo-1763469024232-e8fdacc42f53?w=1600&q=80",
    theme: { primaryColor: primary, accentColor: accent },
    patternId: "simply-sweet",
    shopTheme: {
      templateId: "simply-sweet",
      tier: SWEET.tier,
      label: SWEET.label,
      layout: SWEET.layout,
      header: SWEET.header,
      card: SWEET.card,
      hero: SWEET.hero,
      tagline: "Premium halo-halo & shakes, delivered ice-cold.",
      promoTitle: "Free delivery on ₱500+",
      promoSubtitle: "Metro Manila · Order before 8 PM for same-day",
      primaryColor: primary,
      accentColor: accent,
      background: SWEET.tokens.background,
      foreground: SWEET.tokens.foreground,
      cardBackground: SWEET.tokens.card,
      muted: SWEET.tokens.muted,
      border: SWEET.tokens.border,
      mode: SWEET.tokens.mode,
      radius: SWEET.tokens.radius,
      displayFont: SWEET.tokens.displayFont,
      previewGradient: `linear-gradient(145deg, ${SWEET.tokens.background} 0%, ${accent}55 45%, ${primary} 100%)`,
    },
    shopCategories: [
      { id: "best-sellers", name: "Best Sellers", slug: "best-sellers" },
      { id: "shakes", name: "Shakes", slug: "shakes" },
      { id: "bundles", name: "Bundles", slug: "bundles" },
      { id: "classics", name: "Classics", slug: "classics" },
    ],
    codEnabled: true,
    subscriptionPlan: "advance",
    storeSettings: {
      ...DEFAULT_STOREFRONT_SETTINGS,
      delivery: {
        ...DEFAULT_STOREFRONT_SETTINGS.delivery,
        flatRate: 89,
        freeDeliveryMin: 500,
      },
      whatsapp: {
        enabled: true,
        phone: "+639171234567",
        greeting: "Hi! Ordering from Halo Queen —",
      },
      shopAssistant: {
        enabled: true,
        name: "Queenie",
        greeting: "Hi! Craving halo-halo? I can help you pick a cup or barkada bucket 🍧",
        tone: "friendly_taglish",
        humanInbox: true,
      },
    },
    products: FLAGSHIP_PRODUCTS,
  };
}
