import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { BranchStockView } from "@/components/branch-stock-view";

export default function Page() {
  return (
    <PatternAdminShell title="Stock by branch" description="Count each branch, move stock between them. Online orders take from the main branch first.">
      <BranchStockView />
    </PatternAdminShell>
  );
}
