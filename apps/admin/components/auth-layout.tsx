import Link from "next/link";
import { GumaLogo } from "@gumakart/ui";

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-guma-navy">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 grid-bg grid-bg-fade opacity-60" />
      <div className="pointer-events-none absolute -top-40 left-1/4 h-[480px] w-[480px] rounded-full bg-guma-purple/15 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 right-1/4 h-[420px] w-[420px] rounded-full bg-guma-emerald/10 blur-[120px]" />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
        <Link href="/" className="mb-8 flex items-center justify-center">
          <GumaLogo on="dark" className="h-16" />
        </Link>

        <div className="rounded-2xl glass-strong p-6 shadow-2xl shadow-black/40 sm:p-8">
          <div className="mb-6 text-center">
            <h1 className="font-display text-2xl font-bold text-white">{title}</h1>
            <p className="mt-2 text-sm text-slate-400">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function AuthField({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-300">
        {label}
      </label>
      {children}
    </div>
  );
}

export const authInputClassName =
  "h-11 w-full rounded-xl border border-white/10 bg-guma-navy/60 px-3 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-guma-purple/50 focus:ring-2 focus:ring-guma-purple/20";

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-guma-rose/25 bg-guma-rose/10 px-3 py-2 text-sm text-guma-rose">
      {message}
    </div>
  );
}

export function AuthSubmitButton({
  loading,
  children,
}: {
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="flex h-11 w-full items-center justify-center rounded-xl gradient-accent text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {loading ? "Please wait..." : children}
    </button>
  );
}
