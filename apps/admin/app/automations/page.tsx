import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { AutomationsView } from "@/components/automations-view";

export default function AutomationsPage() {
  return (
    <PatternAdminShell title="Auto SMS">
      <AutomationsView />
    </PatternAdminShell>
  );
}
