/**
 * Phase 20 — storefront theme fonts, self-hosted by next/font at build time.
 * Replaces the themes' `@import url(fonts.googleapis.com…)`, which chained two extra
 * third-party connections in front of first paint. Each family is a CSS variable
 * (--gf-<name>); nothing is preloaded, so a font file downloads only when a theme uses it.
 */
import {
  Barlow,
  Birthstone_Bounce,
  Chilanka,
  Cormorant_Garamond,
  Cormorant_Upright,
  DM_Sans,
  Dancing_Script,
  Fraunces,
  Inter,
  Jost,
  Lato,
  Marcellus,
  Montserrat,
  Nunito,
  Open_Sans,
  Oswald,
  Playfair_Display,
  Poppins,
  Rajdhani,
  Raleway,
  Roboto_Slab,
  Roboto,
  Sora,
  Ubuntu,
} from "next/font/google";

const gf_barlow = Barlow({ subsets: ["latin"], weight: ["600", "700"], variable: "--gf-barlow", display: "swap", preload: false, adjustFontFallback: false });
const gf_birthstone_bounce = Birthstone_Bounce({ subsets: ["latin"], weight: ["400"], variable: "--gf-birthstone-bounce", display: "swap", preload: false, adjustFontFallback: false });
const gf_chilanka = Chilanka({ subsets: ["latin"], weight: ["400"], variable: "--gf-chilanka", display: "swap", preload: false, adjustFontFallback: false });
const gf_cormorant_garamond = Cormorant_Garamond({ subsets: ["latin"], style: ["normal", "italic"], variable: "--gf-cormorant-garamond", display: "swap", preload: false, adjustFontFallback: false });
const gf_cormorant_upright = Cormorant_Upright({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--gf-cormorant-upright", display: "swap", preload: false, adjustFontFallback: false });
const gf_dm_sans = DM_Sans({ subsets: ["latin"], variable: "--gf-dm-sans", display: "swap", preload: false, adjustFontFallback: false });
const gf_dancing_script = Dancing_Script({ subsets: ["latin"], variable: "--gf-dancing-script", display: "swap", preload: false, adjustFontFallback: false });
const gf_fraunces = Fraunces({ subsets: ["latin"], variable: "--gf-fraunces", display: "swap", preload: false, adjustFontFallback: false });
const gf_inter = Inter({ subsets: ["latin"], variable: "--gf-inter", display: "swap", preload: false, adjustFontFallback: false });
const gf_jost = Jost({ subsets: ["latin"], style: ["normal", "italic"], variable: "--gf-jost", display: "swap", preload: false, adjustFontFallback: false });
const gf_lato = Lato({ subsets: ["latin"], weight: ["300", "400", "700"], variable: "--gf-lato", display: "swap", preload: false, adjustFontFallback: false });
const gf_marcellus = Marcellus({ subsets: ["latin"], weight: ["400"], variable: "--gf-marcellus", display: "swap", preload: false, adjustFontFallback: false });
const gf_montserrat = Montserrat({ subsets: ["latin"], variable: "--gf-montserrat", display: "swap", preload: false, adjustFontFallback: false });
const gf_nunito = Nunito({ subsets: ["latin"], variable: "--gf-nunito", display: "swap", preload: false, adjustFontFallback: false });
const gf_open_sans = Open_Sans({ subsets: ["latin"], style: ["normal", "italic"], variable: "--gf-open-sans", display: "swap", preload: false, adjustFontFallback: false });
const gf_oswald = Oswald({ subsets: ["latin"], variable: "--gf-oswald", display: "swap", preload: false, adjustFontFallback: false });
const gf_playfair_display = Playfair_Display({ subsets: ["latin"], style: ["normal", "italic"], variable: "--gf-playfair-display", display: "swap", preload: false, adjustFontFallback: false });
const gf_poppins = Poppins({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--gf-poppins", display: "swap", preload: false, adjustFontFallback: false });
const gf_rajdhani = Rajdhani({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--gf-rajdhani", display: "swap", preload: false, adjustFontFallback: false });
const gf_raleway = Raleway({ subsets: ["latin"], variable: "--gf-raleway", display: "swap", preload: false, adjustFontFallback: false });
const gf_roboto_slab = Roboto_Slab({ subsets: ["latin"], variable: "--gf-roboto-slab", display: "swap", preload: false, adjustFontFallback: false });
const gf_roboto = Roboto({ subsets: ["latin"], variable: "--gf-roboto", display: "swap", preload: false, adjustFontFallback: false });
const gf_sora = Sora({ subsets: ["latin"], variable: "--gf-sora", display: "swap", preload: false, adjustFontFallback: false });
const gf_ubuntu = Ubuntu({ subsets: ["latin"], weight: ["400", "500"], variable: "--gf-ubuntu", display: "swap", preload: false, adjustFontFallback: false });

/** Put on a wrapper around storefront themes: defines every --gf-* variable. */
export const THEME_FONT_VARIABLES = [gf_barlow.variable, gf_birthstone_bounce.variable, gf_chilanka.variable, gf_cormorant_garamond.variable, gf_cormorant_upright.variable, gf_dm_sans.variable, gf_dancing_script.variable, gf_fraunces.variable, gf_inter.variable, gf_jost.variable, gf_lato.variable, gf_marcellus.variable, gf_montserrat.variable, gf_nunito.variable, gf_open_sans.variable, gf_oswald.variable, gf_playfair_display.variable, gf_poppins.variable, gf_rajdhani.variable, gf_raleway.variable, gf_roboto_slab.variable, gf_roboto.variable, gf_sora.variable, gf_ubuntu.variable].join(" ");

/** Family names this module provides (used by the CSS rewrite test). */
export const THEME_FONT_FAMILIES = ["Barlow", "Birthstone Bounce", "Chilanka", "Cormorant Garamond", "Cormorant Upright", "DM Sans", "Dancing Script", "Fraunces", "Inter", "Jost", "Lato", "Marcellus", "Montserrat", "Nunito", "Open Sans", "Oswald", "Playfair Display", "Poppins", "Rajdhani", "Raleway", "Roboto Slab", "Roboto", "Sora", "Ubuntu"] as const;
