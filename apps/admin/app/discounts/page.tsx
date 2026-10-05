import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { DiscountsView } from "@/components/discounts-view";

export default function Page() {
  return (
    <PatternAdminShell title="Discounts">
      <DiscountsView />
    </PatternAdminShell>
  );
}
