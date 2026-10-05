export function formatSarabPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

/** Split shop name for Sarab-style logo (last 3 chars accented). */
export function splitSarabBrand(name: string): { lead: string; accent: string } {
  const trimmed = name.trim();
  if (trimmed.length <= 3) return { lead: "", accent: trimmed };
  return { lead: trimmed.slice(0, -3), accent: trimmed.slice(-3) };
}
