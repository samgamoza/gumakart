/**
 * Phase 22: buyer demand capture — pure rules shared by checkout, the storefront and tests.
 */

export interface PreorderSettings {
  enabled?: boolean;
  /** Expected ship date, YYYY-MM-DD (Manila). */
  shipDate?: string;
}

/** Today's date in Manila as YYYY-MM-DD. */
export function manilaToday(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The ship date when the product is on pre-order right now: turned on, with a valid date that
 * hasn't passed. Otherwise null (normal stock rules apply).
 */
export function activePreorder(meta: { preorder?: PreorderSettings } | null | undefined, now = new Date()): string | null {
  const p = meta?.preorder;
  if (!p?.enabled || !p.shipDate || !/^\d{4}-\d{2}-\d{2}$/.test(p.shipDate)) return null;
  if (Number.isNaN(Date.parse(`${p.shipDate}T00:00:00Z`))) return null;
  return p.shipDate >= manilaToday(now) ? p.shipDate : null;
}

/** "2026-11-15" → "Nov 15" (adds the year when it isn't this year). */
export function shipDateLabel(shipDate: string, now = new Date()): string {
  const d = new Date(`${shipDate}T00:00:00Z`);
  const sameYear = shipDate.slice(0, 4) === manilaToday(now).slice(0, 4);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}
