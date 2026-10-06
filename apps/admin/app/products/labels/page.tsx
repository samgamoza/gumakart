import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { LabelPrinter } from "@/components/label-printer";

export default function LabelsPage() {
  return (
    <PatternAdminShell title="Barcode labels">
      <LabelPrinter />
    </PatternAdminShell>
  );
}
