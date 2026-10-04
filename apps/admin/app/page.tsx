import { redirect } from "next/navigation";
import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { DashboardView } from "@/components/dashboard-view";
import { getSession } from "@/lib/session";
import { needsOnboarding } from "@gumakart/db";

export default async function DashboardPage() {
  const session = await getSession();

  if (session?.tenantId) {
    // Plan §9: the 4-step onboarding comes first; the Launch wizard is optional.
    if (await needsOnboarding(session.tenantId)) {
      redirect("/onboarding");
    }
  }

  return (
    <PatternAdminShell
      title="Overview"
      description="Your shop at a glance — sales, setup, and every workspace module."
    >
      <DashboardView displayName={session?.displayName ?? "Seller"} />
    </PatternAdminShell>
  );
}
