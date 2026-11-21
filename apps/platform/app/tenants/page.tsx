import Link from "next/link";
import { ChevronRight, Store } from "lucide-react";
import { listTenants } from "@gumakart/db";
import { requireSuperAdmin } from "@/lib/session";
import { PlatformShell } from "@/components/platform-shell";
import { FilterBar } from "@/components/filter-bar";
import { EmptyState, Panel, PlanBadge, StatusPill } from "@/components/ui";
import { formatMoney, formatDate, formatNumber } from "@/lib/format";

interface PageProps {
  searchParams: Promise<{ search?: string; status?: string; plan?: string }>;
}

export default async function TenantsPage({ searchParams }: PageProps) {
  const session = await requireSuperAdmin();
  const filters = await searchParams;
  const tenants = await listTenants(filters);

  return (
    <PlatformShell
      title="Tenants"
      subtitle={`${formatNumber(tenants.length)} shop${tenants.length === 1 ? "" : "s"}`}
      user={{ displayName: session.displayName, email: session.email }}
    >
      <FilterBar
        basePath="/tenants"
        searchPlaceholder="Search shops by name or slug…"
        selects={[
          {
            name: "status",
            label: "All statuses",
            options: [
              { value: "active", label: "Active" },
              { value: "pending", label: "Pending" },
              { value: "suspended", label: "Suspended" },
            ],
          },
          {
            name: "plan",
            label: "All plans",
            options: [
              { value: "free", label: "Free" },
              { value: "growth", label: "Pro (legacy)" },
              { value: "pro", label: "Advance (legacy)" },
              { value: "starter", label: "Starter" },
              { value: "pro_live", label: "Pro Live" },
              { value: "enterprise_vibe", label: "Enterprise Vibe" },
            ],
          },
        ]}
      />

      {tenants.length === 0 ? (
        <EmptyState icon={<Store className="h-5 w-5" />} title="No shops match your filters" />
      ) : (
        <Panel className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-semibold">Shop</th>
                  <th className="px-5 py-3 font-semibold">Owner</th>
                  <th className="px-5 py-3 font-semibold">Plan</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Products</th>
                  <th className="px-5 py-3 text-right font-semibold">GMV</th>
                  <th className="px-5 py-3 font-semibold">Joined</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tenants.map((t) => (
                  <tr key={t.id} className="group transition hover:bg-muted/40">
                    <td className="px-5 py-3">
                      <Link href={`/tenants/${t.id}`} className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-bold text-muted-foreground">
                          {t.name.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold group-hover:text-primary">
                            {t.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">/{t.slug}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <p className="truncate text-muted-foreground">{t.ownerEmail ?? "—"}</p>
                    </td>
                    <td className="px-5 py-3">
                      <PlanBadge plan={t.plan} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill status={t.status} />
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{t.productCount}</td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums">
                      {formatMoney(t.gmv)}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(t.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/tenants/${t.id}`}
                        className="inline-flex items-center text-muted-foreground group-hover:text-primary"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
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
