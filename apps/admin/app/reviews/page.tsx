import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { ReviewsManager } from "@/components/reviews-manager";

export default function ReviewsPage() {
  return (
    <PatternAdminShell title="Reviews">
      <ReviewsManager storefrontUrl={(process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3010").replace(/\/$/, "")} />
    </PatternAdminShell>
  );
}
