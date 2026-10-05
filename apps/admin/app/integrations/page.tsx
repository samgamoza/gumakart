import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { IntegrationsView } from "@/components/integrations-view";

export default function Page() {
  return (
    <PatternAdminShell title="Apps & integrations">
      <IntegrationsView />
    </PatternAdminShell>
  );
}
