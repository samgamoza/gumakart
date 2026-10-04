import { Suspense } from "react";
import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { CheckoutLinksManager } from "@/components/checkout-links-manager";

export default function CheckoutLinksPage() {
  return (
    <PatternAdminShell title="Checkout links">
      <Suspense fallback={null}>
        <CheckoutLinksManager />
      </Suspense>
    </PatternAdminShell>
  );
}
