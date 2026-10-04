/* eslint-disable @next/next/no-img-element */

/**
 * Guma Kart brand assets (from the owner's logo files, 2026-10).
 * Each app serves copies from its own public/brand/ folder:
 *   gumakart-mark.png        cart "G" icon, transparent, works on light and dark
 *   gumakart-logo.png        horizontal logo (icon + GUMAKART + tagline), dark text — light backgrounds
 *   gumakart-logo-white.png  same, white text — dark backgrounds
 */

interface BrandImageProps {
  className?: string;
  title?: string;
}

interface ToneProps extends BrandImageProps {
  /** "light" = page is light (dark text); "dark" = page is dark (white text). */
  on?: "light" | "dark";
}

/** Square cart icon. Kept under the old name so existing call sites keep working. */
export function GumaMark({ className, title = "Guma Kart" }: BrandImageProps) {
  return (
    <img
      src="/brand/gumakart-mark.png"
      alt={title}
      width={256}
      height={256}
      className={["object-contain", className].filter(Boolean).join(" ")}
      draggable={false}
    />
  );
}

/** Horizontal logo: cart icon + GUMAKART + tagline (owner's logo, 2026-10). */
export function GumaLogo({ className, title = "Guma Kart — Your business. One smart cart.", on = "light" }: ToneProps) {
  return (
    <img
      src={on === "dark" ? "/brand/gumakart-logo-white.png" : "/brand/gumakart-logo.png"}
      alt={title}
      width={1200}
      height={207}
      className={["w-auto object-contain", className].filter(Boolean).join(" ")}
      draggable={false}
    />
  );
}

/** @deprecated The logo now carries its own wordmark — kept as an alias of GumaLogo. */
export const GumaWordmark = GumaLogo;
