/* eslint-disable @next/next/no-img-element */

/**
 * Guma Kart brand assets (from the owner's logo files, 2026-10).
 * Each app serves copies from its own public/brand/ folder:
 *   gumakart-mark.png            cart "G" icon, transparent, works on light and dark
 *   gumakart-logo.png            full lockup (icon + GUMAKART + tagline), dark text — light backgrounds
 *   gumakart-logo-white.png      same, white text — dark backgrounds
 *   gumakart-wordmark(-white).png  "GUMAKART" text only, for horizontal headers
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

/** Full stacked logo with tagline. */
export function GumaLogo({ className, title = "Guma Kart — Your business. One smart cart.", on = "light" }: ToneProps) {
  return (
    <img
      src={on === "dark" ? "/brand/gumakart-logo-white.png" : "/brand/gumakart-logo.png"}
      alt={title}
      width={720}
      height={on === "dark" ? 358 : 394}
      className={["h-auto object-contain", className].filter(Boolean).join(" ")}
      draggable={false}
    />
  );
}

/** "GUMAKART" text only, for next to the icon in headers and sidebars. */
export function GumaWordmark({ className, title = "Guma Kart", on = "light" }: ToneProps) {
  return (
    <img
      src={on === "dark" ? "/brand/gumakart-wordmark-white.png" : "/brand/gumakart-wordmark.png"}
      alt={title}
      width={on === "dark" ? 1072 : 977}
      height={96}
      className={["w-auto object-contain", className].filter(Boolean).join(" ")}
      draggable={false}
    />
  );
}
