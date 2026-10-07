import { getShopTemplate } from "./templates";
import type {
  StorePatternDefinition,
  StorePatternId,
  TenantThemeJson,
} from "./types";

export const STORE_PATTERNS: StorePatternDefinition[] = [
  {
    id: "classic",
    label: "Classic Guma",
    description: "Default mobile-first catalog with the standard seller dashboard.",
    tags: ["default", "general"],
    categoryHints: [],
    templateId: "clean-guma",
    storefrontRenderer: "themed",
    dashboardRenderer: "guma",
  },
  {
    id: "simply-sweet",
    label: "Simply Sweet",
    description:
      "Home-bakery storefront with neon accents, vlog hero, and a dark tabbed creator dashboard — ported from the Simply Sweet Creations reference store.",
    tags: ["bakery", "pastry", "vlog", "home baking", "creator", "sweets", "recipes"],
    categoryHints: [
      /bakery|pastry|cake|dessert|sweet|baking/i,
      /home.?baker|home.?kitchen|homemade/i,
      /vlog|creator|content.?creator/i,
      /recipe|delicacy|confection/i,
    ],
    templateId: "simply-sweet",
    storefrontRenderer: "sweet-kitchen",
    dashboardRenderer: "sweet-kitchen",
  },
  {
    id: "bloom",
    label: "Bloom Retail",
    description:
      "Fashion & retail storefront with glass header, product grid, and newsletter footer — ported from Bloomtpl (ThemeWagon).",
    tags: ["fashion", "retail", "apparel", "footwear", "sneakers", "catalog"],
    categoryHints: [
      /fashion|apparel|clothing|streetwear|footwear|sneaker|shoe/i,
      /retail|merchandise|boutique|store/i,
    ],
    templateId: "bloom",
    storefrontRenderer: "bloom",
    dashboardRenderer: "guma",
  },
  {
    id: "sarab",
    label: "Sarab Restaurant",
    description:
      "Fast food & restaurant storefront with menu grid, hero spotlight, and promo marquee — ported from Sarab (ThemeWagon).",
    tags: ["restaurant", "fast food", "catering", "menu", "food"],
    categoryHints: [
      /food|beverage|catering|restaurant|fast.?food|kitchen|bakery/i,
    ],
    templateId: "sarab",
    storefrontRenderer: "sarab",
    dashboardRenderer: "guma",
  },
  {
    id: "furnish",
    label: "Furnish Home",
    description:
      "Furniture & home decor catalog with editorial hero, collection grid, and newsletter — ported from Furnish (ThemeWagon).",
    tags: ["furniture", "home", "interior", "decor", "living room"],
    categoryHints: [
      /furniture|furnish|home.?decor|interior|sofa|couch|chair|living/i,
      /home.?improvement|bedroom|office.?furniture/i,
    ],
    templateId: "furnish",
    storefrontRenderer: "furnish",
    dashboardRenderer: "guma",
  },
  {
    id: "zay",
    label: "Zay Shop",
    description:
      "Classic general retail storefront with top bar, hero carousel, category highlights, and featured product cards — ported from Zay Shop (TemplateMo).",
    tags: ["retail", "general", "catalog", "marketplace", "shop"],
    categoryHints: [
      /retail|general.?merchandise|wholesale|store|shop|market/i,
      /electronics|gadget|accessory|accessories/i,
    ],
    templateId: "zay",
    storefrontRenderer: "zay",
    dashboardRenderer: "guma",
  },
  {
    id: "electro",
    label: "Electro",
    description:
      "Electronics storefront with category sidebar, hero carousel, service strip, and tabbed product grid — ported from Electro Bootstrap (HTML Codex).",
    tags: ["electronics", "gadgets", "phones", "laptops", "tech"],
    categoryHints: [
      /electronics|electronic|gadget|computer|laptop|mobile|phone|tablet|smart/i,
      /tech|appliance|camera|audio|wearable/i,
    ],
    templateId: "electro",
    storefrontRenderer: "electro",
    dashboardRenderer: "guma",
  },
  {
    id: "kaira",
    label: "Kaira Fashion",
    description:
      "Editorial fashion storefront with collection carousel, category banners, product rows, and newsletter — ported from Kaira (TemplatesJungle).",
    tags: ["fashion", "apparel", "clothing", "boutique", "style"],
    categoryHints: [
      /fashion|apparel|clothing|boutique|streetwear|dress|wear/i,
      /beauty.?product|skincare|accessories|handbag|jewelry/i,
    ],
    templateId: "kaira",
    storefrontRenderer: "kaira",
    dashboardRenderer: "guma",
  },
  {
    id: "foodmart",
    label: "FoodMart Grocery",
    description:
      "Grocery storefront with search header, hero banners, category carousel, and tabbed product grid — ported from FoodMart (TemplatesJungle).",
    tags: ["grocery", "supermarket", "food", "mart", "sari-sari"],
    categoryHints: [
      /grocery|supermarket|sari.?sari|convenience|mart|provision/i,
      /food.?mart|pantry|fresh.?market|wet.?market/i,
    ],
    templateId: "foodmart",
    storefrontRenderer: "foodmart",
    dashboardRenderer: "guma",
  },
  {
    id: "stylish",
    label: "Stylish Footwear",
    description:
      "Shoe & apparel brand storefront with promo top bar, hero banners, coupon strip, hover product cards, and collection blocks — ported from Stylish (TemplatesJungle).",
    tags: ["shoes", "footwear", "sneakers", "apparel", "streetwear"],
    categoryHints: [
      /shoe|footwear|sneaker|sneakers|boot|loafer|sandal|athletic.?wear/i,
      /apparel.?brand|streetwear|sportswear|running.?shoe/i,
    ],
    templateId: "stylish",
    storefrontRenderer: "stylish",
    dashboardRenderer: "guma",
  },
  {
    id: "mellow",
    label: "Mellow Hotel",
    description:
      "Hotel & resort storefront with contact top bar, booking hero, about strip, room cards, gallery, and amenities — ported from Mellow (TemplatesJungle).",
    tags: ["hotel", "resort", "hospitality", "accommodation", "staycation"],
    categoryHints: [
      /hotel|resort|hospitality|accommodation|staycation|inn|lodge|villa/i,
      /bed.?and.?breakfast|bnb|hostel|guest.?house/i,
    ],
    templateId: "mellow",
    storefrontRenderer: "mellow",
    dashboardRenderer: "guma",
  },
  {
    id: "organic",
    label: "Organic Farm",
    description:
      "Organic & farm produce storefront with search header, hero banner, category carousel, tabbed product grid, and promo strip — ported from Organic (TemplatesJungle).",
    tags: ["organic", "farm", "produce", "vegetables", "healthy", "natural"],
    categoryHints: [
      /organic|farm.?fresh|farm.?produce|produce|vegetable|fruit.?stand/i,
      /farmer.?market|harvest|natural.?food|health.?food/i,
    ],
    templateId: "organic",
    storefrontRenderer: "organic",
    dashboardRenderer: "guma",
  },
  {
    id: "waggy",
    label: "Waggy Pet Shop",
    description:
      "Pet lover storefront with search header, hero banner, icon categories, tabbed product grid, promo strip, and services — ported from Waggy (TemplatesJungle).",
    tags: ["pet", "pets", "dog", "cat", "animal", "pet supplies"],
    categoryHints: [
      /pet|pets|pet.?shop|pet.?store|pet.?supplies|pet.?lover/i,
      /dog|cat|bird|fish|aquarium|animal/i,
    ],
    templateId: "waggy",
    storefrontRenderer: "waggy",
    dashboardRenderer: "guma",
  },
  {
    id: "fruitables",
    label: "Fruitables",
    description:
      "Fruits & vegetables storefront with top bar, hero search, feature strip, tabbed product grid, promo cards, vegetable carousel, and banner — ported from Fruitables (HTML Codex).",
    tags: ["fruit", "vegetable", "produce", "organic", "fresh", "grocery"],
    categoryHints: [
      /fruit|vegetable|fruits|vegetables|fruitables|fresh.?produce/i,
      /green.?grocers|wet.?market|produce.?shop|farm.?stand/i,
    ],
    templateId: "fruitables",
    storefrontRenderer: "fruitables",
    dashboardRenderer: "guma",
  },
  {
    id: "ministore",
    label: "MiniStore",
    description:
      "Gadgets & tech storefront with sticky header, hero billboard, service strip, mobile product carousel, smart watch row, and sale banner — ported from MiniStore.",
    tags: ["electronics", "gadgets", "phones", "watches", "tech"],
    categoryHints: [
      /ministore|gadget|tech.?store|smart.?watch|wearable/i,
      /electronics|electronic|computer|laptop|mobile|phone|tablet|smart/i,
    ],
    templateId: "ministore",
    storefrontRenderer: "ministore",
    dashboardRenderer: "guma",
  },
  {
    id: "aircon",
    label: "AirCon HVAC",
    description:
      "AC repair & HVAC service storefront with quote hero, service grid, bookable packages, and free quote form — ported from AirCon (ThemeWagon).",
    tags: ["hvac", "aircon", "ac repair", "cooling", "heating"],
    categoryHints: [
      /hvac|air.?con|aircon|air.?condition|cooling|heating|ac.?repair|refrigeration/i,
    ],
    templateId: "aircon",
    storefrontRenderer: "aircon",
    dashboardRenderer: "guma",
  },
  {
    id: "carserv",
    label: "CarServ Auto",
    description:
      "Auto repair storefront with booking hero, service tabs, parts & labor packages — ported from CarServ (ThemeWagon).",
    tags: ["auto", "car repair", "garage", "mechanic", "parts"],
    categoryHints: [
      /auto.?shop|car.?repair|car.?service|garage|mechanic|auto.?repair|vehicle.?service/i,
      /automotive.?service|oil.?change|brake.?service/i,
    ],
    templateId: "carserv",
    storefrontRenderer: "carserv",
    dashboardRenderer: "guma",
  },
  {
    id: "motto",
    label: "Motto Moto",
    description:
      "Motorcycle & moto gear ecommerce with bold black/white hero and product grid — ported from Motto (ThemeWagon).",
    tags: ["motorcycle", "moto", "gear", "helmet", "bike"],
    categoryHints: [
      /moto|motorcycle|motorbike|helmet|riding.?gear|scooter.?shop/i,
    ],
    templateId: "motto",
    storefrontRenderer: "motto",
    dashboardRenderer: "guma",
  },
  {
    id: "studio",
    label: "Studio Creative",
    description:
      "Photography & creative packages with portfolio hero and print/signage interim — ported from Studio (ThemeWagon).",
    tags: ["photography", "studio", "creative", "print", "signage"],
    categoryHints: [
      /photograph|photo.?studio|creative.?studio|print(ing)?|signage|graphic.?design/i,
    ],
    templateId: "studio",
    storefrontRenderer: "studio",
    dashboardRenderer: "guma",
  },
  {
    id: "haircut",
    label: "HairCut Salon",
    description:
      "Barbershop & salon appointments with dark service grid and pricing — ported from HairCut (ThemeWagon).",
    tags: ["barber", "salon", "haircut", "grooming", "beauty"],
    categoryHints: [
      /barber|hair.?salon|haircut|gupit|beauty.?salon|spa|nail.?salon|lash/i,
      /grooming|fade|shave|hair.?color/i,
    ],
    templateId: "haircut",
    storefrontRenderer: "haircut",
    dashboardRenderer: "guma",
  },
  {
    id: "specialty",
    label: "Specialty",
    description:
      "Single-offer specialty storefront that highlights one hero product or service for focused conversion.",
    tags: ["specialty", "single product", "flagship", "hero offer"],
    categoryHints: [
      /specialty|single.?product|flagship|signature.?service|one.?product/i,
      /phone.?repair|device.?repair|cellphone.?repair|gadget.?repair/i,
    ],
    templateId: "specialty",
    storefrontRenderer: "specialty",
    dashboardRenderer: "guma",
  },
  {
    id: "palenke",
    label: "Palenke",
    description:
      "Bright, friendly shop with a gradient banner in your colour, category chips and big product cards with Add to basket.",
    tags: ["palenke", "everyday", "food", "bright", "mobile-first"],
    // Picked by choice only — no category hints, so existing shops never switch to it on their own.
    categoryHints: [],
    templateId: "palenke",
    storefrontRenderer: "palenke",
    dashboardRenderer: "guma",
  },
];

export const STORE_PATTERN_MAP = Object.fromEntries(
  STORE_PATTERNS.map((pattern) => [pattern.id, pattern])
) as Record<StorePatternId, StorePatternDefinition>;

const CUTE_PALETTE_IDS = ["bubblegum", "halo-halo", "dragonfruit", "taho-caramel", "coral-reef"];

/** Structural toggles available within the Simply Sweet pattern. */
export const SIMPLY_SWEET_HERO_STYLES = ["photo-overlay", "soft-gradient"] as const;
export const SIMPLY_SWEET_SECTION_FLAGS = [
  "vlogTeaser",
  "socialProof",
  "aboutStrip",
  "featuredRow",
] as const;
export const SIMPLY_SWEET_PROMO_VARIANTS = 8;
export const SIMPLY_SWEET_TAGLINE_VARIANTS = 6;

/**
 * Deterministic unique identities the Simply Sweet pattern can produce before
 * free-form color/logo/cover overrides:
 *
 *   2 hero styles
 * × 2⁴ section visibility combos (vlog / social proof / about / featured)
 * × 5 cute palettes
 * × 8 promo lines
 * × 6 tagline patterns
 * = 7,680 paired storefront + dashboard looks
 *
 * Growth/Pro unlocks extra sections (live selling, deals) which doubles section
 * combos → up to 15,360. Custom primary/accent colors and uploaded media make
 * the space effectively unbounded for production shops.
 */
export const SIMPLY_SWEET_VARIATION_COUNT = {
  heroStyles: SIMPLY_SWEET_HERO_STYLES.length,
  sectionCombos: 2 ** SIMPLY_SWEET_SECTION_FLAGS.length,
  palettes: CUTE_PALETTE_IDS.length,
  promoVariants: SIMPLY_SWEET_PROMO_VARIANTS,
  taglineVariants: SIMPLY_SWEET_TAGLINE_VARIANTS,
  deterministicTotal:
    SIMPLY_SWEET_HERO_STYLES.length *
    2 ** SIMPLY_SWEET_SECTION_FLAGS.length *
    CUTE_PALETTE_IDS.length *
    SIMPLY_SWEET_PROMO_VARIANTS *
    SIMPLY_SWEET_TAGLINE_VARIANTS,
  withPremiumSections:
    SIMPLY_SWEET_HERO_STYLES.length *
    2 ** (SIMPLY_SWEET_SECTION_FLAGS.length + 2) *
    CUTE_PALETTE_IDS.length *
    SIMPLY_SWEET_PROMO_VARIANTS *
    SIMPLY_SWEET_TAGLINE_VARIANTS,
};

export function isStorePatternId(value: string): value is StorePatternId {
  return value in STORE_PATTERN_MAP;
}

export function getStorePattern(id: StorePatternId): StorePatternDefinition {
  return STORE_PATTERN_MAP[id];
}

export function matchStorePattern(input: {
  category?: string | null;
  vibe?: string | null;
  templateId?: string | null;
}): StorePatternId {
  const templateId = input.templateId?.trim();
  if (templateId === "simply-sweet") return "simply-sweet";
  if (templateId === "bloom") return "bloom";
  if (templateId === "sarab") return "sarab";
  if (templateId === "furnish") return "furnish";
  if (templateId === "zay") return "zay";
  if (templateId === "electro") return "electro";
  if (templateId === "kaira") return "kaira";
  if (templateId === "foodmart") return "foodmart";
  if (templateId === "stylish") return "stylish";
  if (templateId === "mellow") return "mellow";
  if (templateId === "organic") return "organic";
  if (templateId === "waggy") return "waggy";
  if (templateId === "fruitables") return "fruitables";
  if (templateId === "ministore") return "ministore";
  if (templateId === "aircon") return "aircon";
  if (templateId === "carserv") return "carserv";
  if (templateId === "motto") return "motto";
  if (templateId === "studio") return "studio";
  if (templateId === "haircut") return "haircut";
  if (templateId === "specialty") return "specialty";
  if (templateId === "palenke") return "palenke";

  const category = input.category?.trim() ?? "";
  if (category) {
    const matched = STORE_PATTERNS.find(
      (pattern) =>
        pattern.id !== "classic" &&
        pattern.categoryHints.some((hint) => hint.test(category))
    );
    if (matched) return matched.id;
  }

  if (input.vibe === "cute" && /bakery|pastry|sweet|baking|dessert/i.test(category)) {
    return "simply-sweet";
  }

  return "classic";
}

export function resolveStorePattern(themeJson: TenantThemeJson | null | undefined): StorePatternId {
  const stored = themeJson?.patternId?.trim();
  if (stored && isStorePatternId(stored)) return stored;

  return matchStorePattern({
    category: null,
    vibe: themeJson?.vibe,
    templateId: themeJson?.templateId,
  });
}

export function resolvePatternThemeDefaults(patternId: StorePatternId): TenantThemeJson {
  const pattern = getStorePattern(patternId);
  const template = getShopTemplate(pattern.templateId);

  return {
    patternId,
    templateId: pattern.templateId,
    primaryColor: template.tokens.primary,
    accentColor: template.tokens.accent,
    vibe: patternId === "simply-sweet" ? "cute" : undefined,
  };
}
