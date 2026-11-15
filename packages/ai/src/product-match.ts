/**
 * Which product is the buyer asking about? Plain word matching against product titles —
 * deterministic on purpose, so the checkout link the assistant sends never depends on the model.
 * Returns null when it isn't clear; the assistant then sends the shop link as before.
 */

export interface MatchableProduct {
  id: string;
  title: string;
}

// Words that say "I want to buy" but don't name a product (English + Tagalog).
const INTENT = new Set([
  "available", "avail", "interested", "interesado", "order", "orders", "buy", "bili", "pabili", "bibili",
  "magkano", "price", "presyo", "hm", "mine", "checkout", "stock", "stocks", "meron", "kuha", "kukuha", "pwede",
]);
// Filler that should never count as naming a product.
const STOP = new Set([
  "the", "and", "for", "you", "your", "this", "that", "with", "have", "has", "are", "can", "how", "much", "pls", "please",
  "ito", "yan", "yung", "ang", "mga", "ako", "ko", "mo", "po", "ba", "pa", "na", "ng", "sa", "may", "lang", "din", "rin",
  "hi", "hello", "what", "still", "one", "pcs", "pc",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

export function hasBuyingIntent(message: string): boolean {
  const w = words(message);
  return w.some((x) => INTENT.has(x)) || /how\s+much|how\s+to\s+order|paano\s+(um)?order/i.test(message);
}

export function matchProductForMessage<T extends MatchableProduct>(message: string, products: T[]): T | null {
  if (products.length === 0) return null;
  const said = new Set(words(message).filter((w) => !STOP.has(w) && !INTENT.has(w)));

  let best: { product: T; score: number; hits: number } | null = null;
  let tie = false;
  for (const product of products) {
    const titleWords = [...new Set(words(product.title).filter((w) => !STOP.has(w)))];
    if (titleWords.length === 0) continue;
    const hits = titleWords.filter((w) => said.has(w)).length;
    if (hits === 0) continue;
    const score = hits / titleWords.length;
    if (!best || hits > best.hits || (hits === best.hits && score > best.score)) {
      best = { product, score, hits };
      tie = false;
    } else if (hits === best.hits && score === best.score) {
      tie = true;
    }
  }
  // A clear single winner that covers at least half of the product's name.
  if (best && !tie && best.score >= 0.5) return best.product;

  // A one-product shop: "available pa?" can only mean that product.
  if (!best && products.length === 1 && hasBuyingIntent(message)) return products[0]!;
  return null;
}
