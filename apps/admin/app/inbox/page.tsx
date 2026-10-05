import { Suspense } from "react";
import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { SocialInbox } from "@/components/social-inbox";

export default function InboxPage() {
  return (
    <PatternAdminShell title="Chats">
      <Suspense fallback={null}>
        <SocialInbox />
      </Suspense>
    </PatternAdminShell>
  );
}
