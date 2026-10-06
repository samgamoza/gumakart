import type { ButtonHTMLAttributes, ReactNode } from "react";

export { GumaLogo, GumaMark, GumaWordmark } from "./logo";

// Token-based so each app themes itself from its own CSS variables:
// admin resolves these to its dark Guma One palette, web/platform to light.
const variants = {
  primary: "bg-primary text-primary-foreground hover:opacity-90 shadow-sm",
  secondary:
    "bg-secondary text-secondary-foreground border border-border hover:bg-muted",
  ghost: "bg-transparent text-foreground hover:bg-muted",
} as const;

const sizes = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-xl font-semibold transition-colors disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04),0_10px_30px_-18px_rgba(15,23,42,.18)] ${className}`}>
      {children}
    </div>
  );
}

export function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground ${className}`}
    >
      {children}
    </span>
  );
}

export function formatPrice(amount: number): string {
  // Whole pesos without decimals (₱1,890); otherwise always two (₱31,741.40, never ₱31,741.4).
  const whole = Math.abs(Math.round(amount * 100)) % 100 === 0;
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount);
}

/**
 * High-contrast form fields for review/testing (warm orange surface + dark ink).
 * Use on seller console and storefront checkout so typed text stays readable.
 */
export const fieldClassName =
  "h-11 w-full rounded-xl border border-orange-300 bg-orange-50 px-3 text-sm text-stone-900 placeholder:text-stone-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-400/30 disabled:cursor-not-allowed disabled:opacity-50";

export const textareaFieldClassName =
  "w-full rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-400/30 disabled:cursor-not-allowed disabled:opacity-50";

export const selectFieldClassName =
  "h-11 w-full rounded-xl border border-orange-300 bg-orange-50 px-3 text-sm text-stone-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-400/30 disabled:cursor-not-allowed disabled:opacity-50";
