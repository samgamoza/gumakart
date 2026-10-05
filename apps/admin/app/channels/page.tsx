import { Suspense } from "react";
import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { ChannelsView } from "@/components/channels-view";

export default function ChannelsPage() {
  return (
    <PatternAdminShell title="Channels">
      <Suspense fallback={null}>
        <ChannelsView />
      </Suspense>
    </PatternAdminShell>
  );
}
