import { PatternAdminShell } from "@/components/pattern-admin-shell";
import { HelpCenter } from "@/components/help-center";

export default function Page() {
  const statusUrl = `${(process.env.NEXT_PUBLIC_STOREFRONT_URL || "https://kart.guma.one").replace(/\/$/, "")}/status`;
  return (
    <PatternAdminShell title="Help" description="Mga sagot sa karaniwang tanong — Taglish, maikli, may link sa tamang page.">
      <HelpCenter statusUrl={statusUrl} />
    </PatternAdminShell>
  );
}
