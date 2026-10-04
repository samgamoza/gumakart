import { GumaLogo } from "@gumakart/ui";
import { ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Platform Console — Sign in" };

export default function LoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950">
      <div className="absolute inset-0 sidebar-glow opacity-40" />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <GumaLogo on="dark" className="h-14" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
            <ShieldCheck className="h-3.5 w-3.5" />
            Platform Console
          </span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/95 p-6 shadow-2xl backdrop-blur sm:p-8">
          <div className="mb-6 text-center">
            <h1 className="font-display text-2xl font-bold text-gray-900">Super-admin sign in</h1>
            <p className="mt-2 text-sm text-gray-500">
              Restricted access. Platform administrators only.
            </p>
          </div>
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-emerald-200/60">
          Unauthorized access is monitored and logged.
        </p>
      </div>
    </div>
  );
}
