import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { ReportsView } from "@/components/reports-view";

export default function Page() {
  return (
    <PatternAdminShell title="Reports">
      <ReportsView />
    </PatternAdminShell>
  );
}
