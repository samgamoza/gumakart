import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { GiftCardsView } from "@/components/gift-cards-view";

export default function Page() {
  return (
    <PatternAdminShell title="Gift cards & store credit">
      <GiftCardsView />
    </PatternAdminShell>
  );
}
