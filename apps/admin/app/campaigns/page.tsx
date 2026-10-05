import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { CampaignsView } from "@/components/campaigns-view";

export default function Page() {
  return (
    <PatternAdminShell title="SMS campaigns">
      <CampaignsView />
    </PatternAdminShell>
  );
}
