export function formatCarservPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export function carservBrandName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || name;
}

export function carservPhone(tenant: {
  storeSettings: { whatsapp: { enabled: boolean; phone?: string } };
}): string | null {
  const { whatsapp } = tenant.storeSettings;
  return whatsapp.enabled && whatsapp.phone ? whatsapp.phone : null;
}

export const CARSERV_HERO_IMAGES = [
  "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=1400&q=80",
  "https://images.unsplash.com/photo-1625047509248-ec889cbff17f?w=1400&q=80",
];

export const CARSERV_HERO_CAR =
  "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=600&q=80";

export const CARSERV_FEATURE_SERVICES = [
  {
    title: "Quality Servicing",
    desc: "Certified technicians and OEM-grade parts on every job.",
    icon: "certificate" as const,
    alt: false,
  },
  {
    title: "Expert Workers",
    desc: "Award-winning mechanics with years of hands-on experience.",
    icon: "workers" as const,
    alt: true,
  },
  {
    title: "Modern Equipment",
    desc: "State-of-the-art diagnostic tools for accurate repairs.",
    icon: "tools" as const,
    alt: false,
  },
];

export const CARSERV_REPAIR_SERVICES = [
  { id: "diagnostic", label: "Diagnostic Test", image: "https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=600&q=80" },
  { id: "engine", label: "Engine Servicing", image: "https://images.unsplash.com/photo-1625047509168-a8dd4e900e2f?w=600&q=80" },
  { id: "tires", label: "Tires Replacement", image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80" },
  { id: "oil", label: "Oil Changing", image: "https://images.unsplash.com/photo-1625047509248-ec889cbff17f?w=600&q=80" },
];
