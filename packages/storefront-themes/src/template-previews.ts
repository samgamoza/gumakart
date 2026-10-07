import type { ShopTemplateId } from "./types";

/**
 * Curated storefront preview stills for Launch / template picker.
 * These stand in until we ship generated screenshots of each live renderer.
 */
export const TEMPLATE_PREVIEW_IMAGES: Record<ShopTemplateId, string> = {
  "clean-guma":
    "https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=960&q=80",
  "mono-market":
    "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=960&q=80",
  "blush-bakery":
    "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=960&q=80",
  "simply-sweet":
    "https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=960&q=80",
  "neon-bazaar":
    "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=960&q=80",
  "street-cart":
    "https://images.unsplash.com/photo-1555939594-58edbcdf8fc3?w=960&q=80",
  "magazine-rack":
    "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=960&q=80",
  "glass-future":
    "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=960&q=80",
  "y2k-chrome":
    "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=960&q=80",
  "holo-grid":
    "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=960&q=80",
  bloom: "https://images.unsplash.com/photo-1445205170230-053b83016050?w=960&q=80",
  sarab: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=960&q=80",
  furnish: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=960&q=80",
  zay: "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=960&q=80",
  electro: "https://images.unsplash.com/photo-1498049794561-7780e7231661?w=960&q=80",
  kaira: "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=960&q=80",
  foodmart: "https://images.unsplash.com/photo-1542838132-92c53300491e?w=960&q=80",
  stylish: "https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=960&q=80",
  mellow: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=960&q=80",
  organic: "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=960&q=80",
  waggy: "https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=960&q=80",
  fruitables: "https://images.unsplash.com/photo-1610832958506-aa563bf15cff?w=960&q=80",
  ministore: "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=960&q=80",
  aircon: "https://images.unsplash.com/photo-1631545806609-c2b666c4a6f4?w=960&q=80",
  carserv: "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=960&q=80",
  motto: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=960&q=80",
  studio: "https://images.unsplash.com/photo-1452587925148-ce544e77e382?w=960&q=80",
  haircut: "https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=960&q=80",
  palenke: "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=960&q=80",
  specialty: "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=960&q=80",
};

/** Category mood images when recommending from the Free Bundle library (not yet ported). */
export const CATEGORY_PREVIEW_IMAGES: Record<string, string> = {
  "Food & Beverage":
    "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=960&q=80",
  "Fashion & Apparel":
    "https://images.unsplash.com/photo-1445205170230-053b83016050?w=960&q=80",
  "Printing & Signage":
    "https://images.unsplash.com/photo-1562654501-a0ccc0fc3fb1?w=960&q=80",
  "Auto Shop & Services":
    "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=960&q=80",
  "HVAC & Air Conditioning":
    "https://images.unsplash.com/photo-1631545806609-c2b666c4a6f4?w=960&q=80",
  "Photography & Creative":
    "https://images.unsplash.com/photo-1452587925148-ce544e77e382?w=960&q=80",
  "Barber & Hair Salons":
    "https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=960&q=80",
  "Beauty Salons & Spas":
    "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=960&q=80",
  "Appliance & Device Repair":
    "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=960&q=80",
  "Home Services & Trades":
    "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=960&q=80",
  "Automotive Parts & Accessories":
    "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=960&q=80",
  "Car Wash & Detailing":
    "https://images.unsplash.com/photo-1601362840469-51e4d8d58785?w=960&q=80",
  Electronics:
    "https://images.unsplash.com/photo-1498049794561-7780e7231661?w=960&q=80",
  "Retail & General Merchandise":
    "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=960&q=80",
  "Professional & Consulting":
    "https://images.unsplash.com/photo-1497366216548-37526070297c?w=960&q=80",
  General: "https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=960&q=80",
  // Reuse photos already curated above so a category never borrows another
  // industry's look (Beauty used to fall back to the fashion template still).
  "Beauty & Skincare":
    "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=960&q=80",
  Catering: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=960&q=80",
  "Shoes & Footwear":
    "https://images.unsplash.com/photo-1445205170230-053b83016050?w=960&q=80",
  "Grocery & Supermarket":
    "https://images.unsplash.com/photo-1542838132-92c53300491e?w=960&q=80",
  "Organic & Farm Produce":
    "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=960&q=80",
  "Pet Supplies & Lovers":
    "https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=960&q=80",
  "Furniture & Home":
    "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=960&q=80",
  "Hotels & Resorts":
    "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=960&q=80",
};

export function previewImageForTemplate(id: ShopTemplateId): string {
  return TEMPLATE_PREVIEW_IMAGES[id] ?? CATEGORY_PREVIEW_IMAGES.General!;
}

export function previewImageForCategory(category: string): string {
  return CATEGORY_PREVIEW_IMAGES[category] ?? CATEGORY_PREVIEW_IMAGES.General!;
}
