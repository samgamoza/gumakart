"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthError, AuthLayout, AuthSubmitButton } from "@/components/auth-layout";
import { BusinessFields, EMPTY_BUSINESS, validateBusiness, type BusinessForm } from "@/components/business-step";

/** Google sign-up, step 1 of 4 — "Your business" (plan §9). */
export function GoogleShopSetupForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [business, setBusiness] = useState<BusinessForm>(EMPTY_BUSINESS);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (!data.ok) {
          router.replace("/login");
          return;
        }
        if (!data.user?.needsShopSetup) {
          router.replace("/");
          return;
        }
        setEmail(data.user.email ?? "");
      })
      .finally(() => setCheckingSession(false));
  }, [router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const problem = validateBusiness(business);
    if (problem) {
      setError(problem);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/google/complete-shop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...business, chatUrl: business.chatUrl || undefined }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Could not create your shop.");
        return;
      }
      router.push(data.redirectTo ?? "/onboarding");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <AuthLayout title="Setting up your shop" subtitle="Loading your Google account…">
        <p className="text-center text-sm text-muted-foreground">Please wait…</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Your business"
      subtitle={email ? `Step 1 of 4 · Signed in as ${email}` : "Step 1 of 4"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthError message={error} />
        <BusinessFields value={business} onChange={setBusiness} />
        <div className="pt-2">
          <AuthSubmitButton loading={loading}>Continue</AuthSubmitButton>
        </div>
      </form>
    </AuthLayout>
  );
}
