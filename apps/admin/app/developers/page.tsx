import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { DevelopersView } from "@/components/developers-view";

export default function Page() {
  return (
    <PatternAdminShell title="API & webhooks">
      <DevelopersView />
    </PatternAdminShell>
  );
}
