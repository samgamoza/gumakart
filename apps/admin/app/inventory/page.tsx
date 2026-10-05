import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { InventoryManager } from "@/components/inventory-manager";

export default function InventoryPage() {
  return (
    <PatternAdminShell title="Stock">
      <InventoryManager />
    </PatternAdminShell>
  );
}
