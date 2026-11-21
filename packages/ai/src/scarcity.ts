/**
 * A scarcity claim needs a marker — "last 5", "5 na lang", "5 pcs left", "5 natitira" — so honest
 * quantities ("2 pcs po", "Pandesal (12 pcs)") and prices ("₱249 na lang") are left alone.
 */
export const SCARCITY_CLAIM =
  /\b(?:last|huling)\s+(\d{1,4})(?:\s*(?:pcs|pieces|piraso|stocks?|slots?|items?))?(?:\s*(?:na lang|left|lang|only))?|(?<![₱$]\s?|PHP\s?|Php\s?|[\d.,])\b(\d{1,4})\s*(?:pcs|pieces|piraso|stocks?|slots?|items?)?\s*(?:na lang|left|remaining|natitira)\b/gi;
