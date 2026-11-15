/**
 * Whether an order counts as AI-assisted / AI-closed (reported on the ops metrics page).
 *  - closed:   the AI sent the checkout link itself, with no seller action. Decided only by the
 *              link's stored origin, which the server sets — a buyer can't claim it.
 *  - assisted: closed, or the link was an AI draft the seller sent, or the buyer arrived from the
 *              shop assistant's link (utm_source=shop_assistant; reported by the browser, so this
 *              part is best-effort).
 */
export function aiAttributionOf(input: { linkOrigin: string | null; utmSource: string | null }): {
  assisted: boolean;
  closed: boolean;
} {
  const closed = input.linkOrigin === "ai_auto";
  const assisted = closed || input.linkOrigin === "ai_draft" || input.utmSource === "shop_assistant";
  return { assisted, closed };
}
