export function formatKairaPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export const KAIRA_CATEGORY_IMAGES = [
  "https://images.unsplash.com/photo-1617137968427-85924c800a22?w=600&q=80",
  "https://images.unsplash.com/photo-1483985988350-763728e1935b?w=600&q=80",
  "https://images.unsplash.com/photo-1520903920243-00d872a2d1c9?w=600&q=80",
];

export const KAIRA_COLLECTION_IMAGE =
  "https://images.unsplash.com/photo-1445205170230-053b83016050?w=900&q=80";

export const KAIRA_BANNER_IMAGES = [
  "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=700&q=80",
  "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=700&q=80",
  "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=700&q=80",
];
