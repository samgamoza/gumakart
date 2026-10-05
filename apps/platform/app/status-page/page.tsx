import { getPublicStatus } from "@gumakart/db";
import { requireSuperAdmin } from "@/lib/session";
import { PlatformShell } from "@/components/platform-shell";
import { Panel, SectionHeader } from "@/components/ui";
import { IncidentUpdateForm, NewIncidentForm } from "@/components/incident-forms";

export const dynamic = "force-dynamic";

const STATE_LABEL: Record<string, string> = {
  operational: "Working",
  maintenance: "Maintenance",
  degraded: "Slow / delayed",
  partial_outage: "Partly down",
  major_outage: "Down",
};

/** Phase 16 — what sellers see at kart.guma.one/status, and the incident log behind it. */
export default async function StatusPageAdmin() {
  const session = await requireSuperAdmin();
  const status = await getPublicStatus();
  const publicUrl = `${process.env.NEXT_PUBLIC_STOREFRONT_URL?.replace(/\/$/, "") || "https://kart.guma.one"}/status`;
  return (
    <PlatformShell title="Status page" subtitle="Post incidents and maintenance for sellers" user={{ displayName: session.displayName, email: session.email }}>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <Panel>
            <SectionHeader
              title="What sellers see now"
              description="Automatic alerts mark a part as slow; incidents you post override that."
              action={
                <a href={publicUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                  Open public page ↗
                </a>
              }
            />
            <ul className="divide-y divide-border text-sm">
              {status.components.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  {c.label}
                  <span className={`rounded-full px-2 py-0.5 text-xs ${c.state === "operational" ? "bg-emerald-500/15 text-emerald-700" : c.state === "maintenance" ? "bg-sky-500/15 text-sky-700" : "bg-rose-500/15 text-rose-700"}`}>
                    {STATE_LABEL[c.state]}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <SectionHeader title="New incident" description="Write for sellers — plain words, what's affected, what still works." />
            <NewIncidentForm />
          </Panel>
        </div>
        <Panel>
          <SectionHeader title="Incidents (30 days)" />
          {status.active.length + status.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No incidents.</p>
          ) : (
            <ul className="space-y-4" data-testid="incident-list">
              {[...status.active, ...status.history].map((i) => (
                <li key={i.id} className="rounded-xl border border-border p-4">
                  <p className="font-semibold">
                    {i.title}{" "}
                    <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize">{i.resolvedAt ? "resolved" : i.status}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {i.impact} · {i.components.join(", ")} · {i.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                  </p>
                  <ol className="mt-2 space-y-1 border-l border-border pl-3 text-sm">
                    {i.updates.map((u, idx) => (
                      <li key={idx}>
                        <span className="font-medium capitalize">{u.status}</span> — {u.message}{" "}
                        <span className="text-xs text-muted-foreground">({u.createdAt.toISOString().slice(11, 16)} UTC)</span>
                      </li>
                    ))}
                  </ol>
                  {!i.resolvedAt && <IncidentUpdateForm id={i.id} current={i.status} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </PlatformShell>
  );
}
