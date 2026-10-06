/**
 * Phase 24: delivery fee by area — the four groups PH couriers price by. Province names follow the
 * PSGC list used at checkout (plus common older/alternate names). Matching is "address province
 * contains this name", so Mindanao is checked before Luzon ("City of Isabela" vs "Isabela").
 */

export type PhArea = "metro_manila" | "mindanao" | "visayas" | "luzon";

export const PH_AREA_LABELS: Record<PhArea, string> = {
  metro_manila: "Metro Manila",
  luzon: "Luzon (outside Metro Manila)",
  visayas: "Visayas",
  mindanao: "Mindanao",
};

/** Check order matters (see above). */
export const PH_AREA_ORDER: PhArea[] = ["metro_manila", "mindanao", "visayas", "luzon"];

export const PH_AREA_PROVINCES: Record<PhArea, string[]> = {
  metro_manila: ["Metro Manila", "NCR", "National Capital Region"],
  mindanao: [
    "City of Isabela", "Basilan", "Lanao del Sur", "Lanao del Norte", "Maguindanao", "Sulu", "Tawi-Tawi",
    "Bukidnon", "Camiguin", "Misamis Occidental", "Misamis Oriental",
    "Zamboanga del Norte", "Zamboanga del Sur", "Zamboanga Sibugay",
    "Compostela Valley", "Davao de Oro", "Davao del Norte", "Davao del Sur", "Davao Occidental", "Davao Oriental",
    "Cotabato", "Sarangani", "Sultan Kudarat",
    "Agusan del Norte", "Agusan del Sur", "Dinagat Islands", "Surigao del Norte", "Surigao del Sur",
  ],
  visayas: [
    "Aklan", "Antique", "Capiz", "Guimaras", "Iloilo", "Negros Occidental", "Negros Oriental",
    "Bohol", "Cebu", "Siquijor", "Biliran", "Samar", "Leyte",
  ],
  luzon: [
    "Abra", "Apayao", "Benguet", "Ifugao", "Kalinga", "Mountain Province",
    "Ilocos Norte", "Ilocos Sur", "La Union", "Pangasinan",
    "Batanes", "Cagayan", "Isabela", "Nueva Vizcaya", "Quirino",
    "Aurora", "Bataan", "Bulacan", "Nueva Ecija", "Pampanga", "Tarlac", "Zambales",
    "Batangas", "Cavite", "Laguna", "Quezon", "Rizal",
    "Marinduque", "Occidental Mindoro", "Oriental Mindoro", "Palawan", "Romblon",
    "Albay", "Camarines Norte", "Camarines Sur", "Catanduanes", "Masbate", "Sorsogon",
  ],
};

export type PhAreaRates = Partial<Record<PhArea, number>>;

/** Which area an address province falls in (null when unknown). Pure; used by tests and previews. */
export function phAreaOf(province: string | null | undefined): PhArea | null {
  const p = (province ?? "").toLowerCase();
  if (!p) return null;
  for (const area of PH_AREA_ORDER) {
    if (PH_AREA_PROVINCES[area].some((name) => p.includes(name.toLowerCase()))) return area;
  }
  return null;
}

/** Only the areas with a valid fee (0–99,999). */
export function cleanAreaRates(rates: PhAreaRates | null | undefined): PhAreaRates {
  const out: PhAreaRates = {};
  for (const area of PH_AREA_ORDER) {
    const v = Number(rates?.[area]);
    if (rates?.[area] != null && Number.isFinite(v) && v >= 0 && v <= 99_999) out[area] = Math.round(v * 100) / 100;
  }
  return out;
}
