import Link from "next/link";
import { Check } from "lucide-react";
import { GumaLogo } from "@gumakart/ui";

const ONBOARDING_STEPS = ["Your business", "First product", "How you get paid", "Share your link"] as const;

const POINTS = [
  { title: "One link for every channel", body: "Share the same checkout link in Facebook, Messenger, Instagram, TikTok, Shopee or Lazada chats." },
  { title: "You get paid directly", body: "Buyers pay by GCash, Maya or cash on delivery. Guma never holds your money." },
  { title: "Four short steps", body: "Your business, first product, payments, then your link is ready to share." },
] as const;

/**
 * Auth / onboarding shell. Default is the narrow centred card (login, forgot password…).
 * `wide` is for onboarding: on desktop a brand + progress column sits beside a roomier form card;
 * on phones it collapses to one column with a compact progress header. `step` is 1–4.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  wide = false,
  step,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  wide?: boolean;
  step?: 1 | 2 | 3 | 4;
}) {
  const logo = (cls: string) => (
    <Link href="/" className={cls} aria-label="Guma Kart home">
      <GumaLogo on="light" className="h-14 dark:hidden lg:h-16" />
      <GumaLogo on="dark" className="hidden h-14 dark:block lg:h-16" />
    </Link>
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-guma-navy">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 grid-bg grid-bg-fade opacity-60" />
      <div className="pointer-events-none absolute -top-40 left-1/4 h-[480px] w-[480px] rounded-full bg-guma-purple/15 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 right-1/4 h-[420px] w-[420px] rounded-full bg-guma-emerald/10 blur-[120px]" />

      {wide ? (
        <div className="relative mx-auto grid min-h-screen w-full max-w-6xl items-center gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:px-10">
          <aside className="hidden lg:block">
            {logo("inline-flex")}
            <h2 className="mt-10 font-display text-4xl font-bold leading-[1.1] tracking-tight text-white">
              Turn every &ldquo;MINE&rdquo; into a paid order.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300">
              Set up your shop once. Then send one checkout link and let buyers finish on their own.
            </p>

            {step && (
              <ol className="mt-10 grid gap-1" aria-label="Setup progress">
                {ONBOARDING_STEPS.map((label, i) => {
                  const n = i + 1;
                  const state = n < step ? "done" : n === step ? "current" : "todo";
                  return (
                    <li key={label} aria-current={state === "current" ? "step" : undefined} className="flex items-center gap-3 py-1.5">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                          state === "todo"
                            ? "border-white/20 text-slate-400"
                            : "border-emerald-700 bg-emerald-700 text-white"
                        }`}
                      >
                        {state === "done" ? <Check className="h-4 w-4" aria-hidden /> : n}
                      </span>
                      <span className={`text-[15px] ${state === "current" ? "font-semibold text-white" : "text-slate-300"}`}>{label}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            <ul className="mt-10 grid gap-5 border-t border-white/10 pt-8">
              {POINTS.map((p) => (
                <li key={p.title}>
                  <p className="text-sm font-semibold text-white">{p.title}</p>
                  <p className="mt-1 max-w-md text-sm leading-relaxed text-slate-400">{p.body}</p>
                </li>
              ))}
            </ul>
          </aside>

          <div className="mx-auto w-full max-w-xl lg:max-w-none">
            {logo("mb-6 flex justify-center lg:hidden")}
            <div className="rounded-3xl glass-strong p-6 shadow-2xl shadow-black/40 sm:p-10">
              {step && (
                <div className="mb-6 lg:hidden">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Step {step} of 4 · {ONBOARDING_STEPS[step - 1]}
                  </p>
                  <div className="flex gap-1.5" aria-hidden>
                    {[1, 2, 3, 4].map((n) => (
                      <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-emerald-600" : "bg-white/10"}`} />
                    ))}
                  </div>
                </div>
              )}
              <div className="mb-8">
                <h1 className="font-display text-3xl font-bold tracking-tight text-white">{title}</h1>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-400">{subtitle}</p>
              </div>
              {children}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
          <Link href="/" className="mb-8 flex items-center justify-center">
            <GumaLogo on="light" className="h-16 dark:hidden" />
            <GumaLogo on="dark" className="hidden h-16 dark:block" />
          </Link>

          <div className="rounded-2xl glass-strong p-6 shadow-2xl shadow-black/40 sm:p-8">
            <div className="mb-6 text-center">
              <h1 className="font-display text-2xl font-bold text-white">{title}</h1>
              <p className="mt-2 text-sm text-slate-400">{subtitle}</p>
            </div>
            {children}
          </div>
        </div>
      )}
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
  "h-12 w-full rounded-xl border border-white/10 bg-guma-navy/60 px-3.5 text-[15px] text-white placeholder:text-slate-500 outline-none transition focus:border-guma-purple/50 focus:ring-2 focus:ring-guma-purple/20";

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl border border-guma-rose/25 bg-guma-rose/10 px-3 py-2 text-sm text-guma-rose">
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
      className="flex h-12 w-full items-center justify-center rounded-xl gradient-cta text-[15px] font-semibold text-white shadow-lg shadow-indigo-900/20 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-60"
    >
      {loading ? "Please wait..." : children}
    </button>
  );
}
