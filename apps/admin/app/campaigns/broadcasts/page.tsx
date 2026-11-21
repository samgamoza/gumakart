import { Suspense } from "react";
import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { BroadcastsView } from "@/components/ai-suite/broadcasts-view";

export default function Page() {
  return (
    <PatternAdminShell title="Payday & restock broadcasts">
      <Suspense fallback={null}>
        <BroadcastsView />
      </Suspense>
    </PatternAdminShell>
  );
}
