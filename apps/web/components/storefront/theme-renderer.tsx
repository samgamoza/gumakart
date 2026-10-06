"use client";

import dynamic from "next/dynamic";
import type { DemoTenant } from "@/lib/demo-data";

/**
 * Phase 20 — the theme switch lives in a client component so next/dynamic really code-splits:
 * a shop downloads only its own theme's JS and CSS (before: all 19 themes, ~86 KB gzipped).
 * Server rendering is unchanged (ssr stays on).
 */
const SweetKitchenStorefront = dynamic(() => import("@/components/storefront/sweet-kitchen/sweet-kitchen-storefront").then((mod) => ({ default: mod.SweetKitchenStorefront })));
const BloomStorefront = dynamic(() => import("@/components/storefront/bloom/bloom-storefront").then((mod) => ({ default: mod.BloomStorefront })));
const SarabStorefront = dynamic(() => import("@/components/storefront/sarab/sarab-storefront").then((mod) => ({ default: mod.SarabStorefront })));
const FurnishStorefront = dynamic(() => import("@/components/storefront/furnish/furnish-storefront").then((mod) => ({ default: mod.FurnishStorefront })));
const ZayStorefront = dynamic(() => import("@/components/storefront/zay/zay-storefront").then((mod) => ({ default: mod.ZayStorefront })));
const ElectroStorefront = dynamic(() => import("@/components/storefront/electro/electro-storefront").then((mod) => ({ default: mod.ElectroStorefront })));
const KairaStorefront = dynamic(() => import("@/components/storefront/kaira/kaira-storefront").then((mod) => ({ default: mod.KairaStorefront })));
const FoodmartStorefront = dynamic(() => import("@/components/storefront/foodmart/foodmart-storefront").then((mod) => ({ default: mod.FoodmartStorefront })));
const StylishStorefront = dynamic(() => import("@/components/storefront/stylish/stylish-storefront").then((mod) => ({ default: mod.StylishStorefront })));
const MellowStorefront = dynamic(() => import("@/components/storefront/mellow/mellow-storefront").then((mod) => ({ default: mod.MellowStorefront })));
const OrganicStorefront = dynamic(() => import("@/components/storefront/organic/organic-storefront").then((mod) => ({ default: mod.OrganicStorefront })));
const WaggyStorefront = dynamic(() => import("@/components/storefront/waggy/waggy-storefront").then((mod) => ({ default: mod.WaggyStorefront })));
const FruitablesStorefront = dynamic(() => import("@/components/storefront/fruitables/fruitables-storefront").then((mod) => ({ default: mod.FruitablesStorefront })));
const MinistoreStorefront = dynamic(() => import("@/components/storefront/ministore/ministore-storefront").then((mod) => ({ default: mod.MinistoreStorefront })));
const AirconStorefront = dynamic(() => import("@/components/storefront/aircon/aircon-storefront").then((mod) => ({ default: mod.AirconStorefront })));
const CarservStorefront = dynamic(() => import("@/components/storefront/carserv/carserv-storefront").then((mod) => ({ default: mod.CarservStorefront })));
const MottoStorefront = dynamic(() => import("@/components/storefront/motto/motto-storefront").then((mod) => ({ default: mod.MottoStorefront })));
const StudioStorefront = dynamic(() => import("@/components/storefront/studio/studio-storefront").then((mod) => ({ default: mod.StudioStorefront })));
const HaircutStorefront = dynamic(() => import("@/components/storefront/haircut/haircut-storefront").then((mod) => ({ default: mod.HaircutStorefront })));
const SpecialtyStorefront = dynamic(() => import("@/components/storefront/specialty/specialty-storefront").then((mod) => ({ default: mod.SpecialtyStorefront })));

const THEMES: Record<string, React.ComponentType<{ tenant: DemoTenant }>> = {
  "sweet-kitchen": SweetKitchenStorefront,
  "bloom": BloomStorefront,
  "sarab": SarabStorefront,
  "furnish": FurnishStorefront,
  "zay": ZayStorefront,
  "electro": ElectroStorefront,
  "kaira": KairaStorefront,
  "foodmart": FoodmartStorefront,
  "stylish": StylishStorefront,
  "mellow": MellowStorefront,
  "organic": OrganicStorefront,
  "waggy": WaggyStorefront,
  "fruitables": FruitablesStorefront,
  "ministore": MinistoreStorefront,
  "aircon": AirconStorefront,
  "carserv": CarservStorefront,
  "motto": MottoStorefront,
  "studio": StudioStorefront,
  "haircut": HaircutStorefront,
  "specialty": SpecialtyStorefront,
};

export const CLIENT_THEME_RENDERERS = Object.keys(THEMES);

export function ThemeRenderer({ renderer, tenant }: { renderer: string; tenant: DemoTenant }) {
  const Theme = THEMES[renderer];
  return Theme ? <Theme tenant={tenant} /> : null;
}
