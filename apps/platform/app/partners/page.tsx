import { Handshake } from "lucide-react";
import { listPartnersForOps, type PartnerStatus } from "@gumakart/db";
import { requireSuperAdmin } from "@/lib/session";
import { PlatformShell } from "@/components/platform-shell";
import { FilterBar } from "@/components/filter-bar";
import { EmptyState, Panel, StatusPill } from "@/components/ui";
import { PartnerActions } from "@/components/partner-actions";
import { formatDate, formatNumber } from "@/lib/format";

interface PageProps {
  searchParams: Promise<{ search?: string; status?: string }>;
}

/** Phase 18: agency partners — approve, suspend; referral counts for a future commission decision. */
export default async function PartnersPage({ searchParams }: PageProps) {
  const session = await requireSuperAdmin();
  const f = await searchParams;
  const status = (["pending", "active", "suspended"] as const).includes(f.status as PartnerStatus) ? (f.status as PartnerStatus) : null;
  const rows = await listPartnersForOps({ status, q: f.search ?? null });
  const pending = rows.filter((r) => r.status === "pending").length;

  return (
    <PlatformShell
      title="Partners"
      subtitle={`${formatNumber(rows.length)} partner${rows.length === 1 ? "" : "s"}${pending ? ` · ${pending} waiting for approval` : ""}`}
      user={{ displayName: session.displayName, email: session.email }}
    >
      <FilterBar
        basePath="/partners"
        searchPlaceholder="Search by name, code or email…"
        selects={[
          {
            name: "status",
            label: "All statuses",
            options: [
              { value: "pending", label: "Pending" },
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
            ],
          },
        ]}
      />
      <p className="mb-4 text-xs text-muted-foreground">
        No commission program yet — referral counts are recorded so a commission can be decided later. Suspending a partner removes their access to every client shop immediately.
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={<Handshake className="h-5 w-5" />} title="No partners match your filters" />
      ) : (
        <Panel className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="ops-partners">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-semibold">Partner</th>
                  <th className="px-5 py-3 font-semibold">Code</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Shops with access</th>
                  <th className="px-5 py-3 text-right font-semibold">Referred (paid)</th>
                  <th className="px-5 py-3 font-semibold">Joined</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-3">
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.email}
                        {r.city ? ` · ${r.city}` : ""}
                        {r.website ? ` · ${r.website}` : ""}
                      </p>
                      {r.about && <p className="mt-1 max-w-md text-xs text-muted-foreground">{r.about}</p>}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs">{r.code}</td>
                    <td className="px-5 py-3">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{r.shopsWithAccess}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {r.referredShops} ({r.referredPaid})
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(r.createdAt)}</td>
                    <td className="px-5 py-3">
                      <PartnerActions partnerId={r.id} name={r.name} status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </PlatformShell>
  );
}
