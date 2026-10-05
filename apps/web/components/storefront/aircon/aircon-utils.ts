export function formatPhpPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export function airconBrandName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || name;
}

export const AIRCON_DEFAULT_PRIMARY = "#FF800F";
export const AIRCON_DEFAULT_ACCENT = "#0D1B2A";

export const AIRCON_HERO_SLIDES = [
  {
    title: "We Provide Best AC Repair Services",
    subtitle: "Fast, reliable cooling solutions for homes and businesses across Metro Manila.",
    image: "https://images.unsplash.com/photo-1631545806609-95e8f39b1d83?w=1400&q=80",
  },
  {
    title: "Quality Heating & Air Condition Services",
    subtitle: "Expert technicians, transparent pricing, and same-day service when you need it most.",
    image: "https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=1400&q=80",
  },
] as const;

export const AIRCON_ABOUT_IMAGES = [
  "https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=500&q=80",
  "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=600&q=80",
  "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=400&q=80",
  "https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=500&q=80",
] as const;

export const AIRCON_STATS = [
  { value: "2,500+", label: "Happy Clients" },
  { value: "4,800+", label: "Projects Succeed" },
  { value: "18+", label: "Awards Achieved" },
  { value: "45+", label: "Team Members" },
] as const;

export const AIRCON_REASONS = [
  {
    title: "Trusted Service Center",
    description: "Licensed HVAC specialists with years of hands-on experience in residential and commercial systems.",
  },
  {
    title: "Reasonable Price",
    description: "Upfront quotes with no hidden fees — you know the cost before we start any repair or installation.",
  },
  {
    title: "24/7 Support",
    description: "Emergency AC breakdown? Our team is on call around the clock to restore your comfort fast.",
  },
] as const;

export const AIRCON_SERVICE_CATEGORIES = [
  {
    title: "AC Installation",
    image: "https://images.unsplash.com/photo-1631545806609-95e8f39b1d83?w=600&q=80",
  },
  {
    title: "Cooling Services",
    image: "https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=600&q=80",
  },
  {
    title: "Heating Services",
    image: "https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=600&q=80",
  },
  {
    title: "Maintenance & Repair",
    image: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=600&q=80",
  },
  {
    title: "Indoor Air Quality",
    image: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=600&q=80",
  },
  {
    title: "Annual Inspections",
    image: "https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=600&q=80",
  },
] as const;
