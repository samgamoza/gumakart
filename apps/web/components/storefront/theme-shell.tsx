import type { CSSProperties, ReactNode } from "react";
import type { ResolvedShopTheme } from "@gumakart/storefront-themes";
import { sizedImageUrl } from "@/lib/image-sizes";

/**
 * Storefront components use Tailwind's `font-display` (var(--font-bricolage)).
 * Remapping that variable per tenant makes the seller's font choice apply to
 * every heading without touching each component.
 */
export function displayFontStack(theme: ResolvedShopTheme): string | undefined {
  switch (theme.displayFont) {
    case "system":
      return "var(--font-jakarta), system-ui, sans-serif";
    case "mono-accent":
      return "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    default:
      return undefined; // bricolage — keep the root font variable
  }
}

export function themeStyle(theme: ResolvedShopTheme): CSSProperties {
  const fontStack = displayFontStack(theme);
  return {
    ["--shop-primary" as string]: theme.primaryColor,
    ["--shop-accent" as string]: theme.accentColor,
    ["--shop-bg" as string]: theme.background,
    ["--shop-fg" as string]: theme.foreground,
    ["--shop-card" as string]: theme.cardBackground,
    ["--shop-muted" as string]: theme.muted,
    ["--shop-border" as string]: theme.border,
    ["--shop-radius" as string]: theme.radius,
    ...(fontStack ? { ["--font-bricolage" as string]: fontStack } : {}),
    background: theme.background,
    color: theme.foreground,
  };
}

export function StorefrontThemeShell({
  theme,
  children,
  className = "",
}: {
  theme: ResolvedShopTheme;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className} style={themeStyle(theme)} data-shop-template={theme.templateId}>
      {children}
    </div>
  );
}

export function heroBackground(theme: ResolvedShopTheme, coverUrl?: string): CSSProperties {
  if (coverUrl && (theme.hero === "photo" || theme.layout === "editorial")) {
    return {
      backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.55)), url(${sizedImageUrl(coverUrl, 600)})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }

  switch (theme.hero) {
    case "mesh":
      return {
        background: `radial-gradient(circle at 20% 20%, ${theme.accentColor}55, transparent 45%), radial-gradient(circle at 80% 0%, ${theme.primaryColor}66, transparent 40%), ${theme.background}`,
      };
    case "chrome":
      return {
        background: `linear-gradient(135deg, ${theme.accentColor}88, ${theme.primaryColor}aa, #fde68a88)`,
      };
    case "noise":
      return {
        background: `linear-gradient(180deg, ${theme.foreground} 0%, ${theme.foreground}dd 100%)`,
      };
    case "photo":
      return {
        background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor})`,
      };
    default:
      return {
        background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor})`,
      };
  }
}
