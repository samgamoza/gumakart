import type { Metadata } from "next";
import { AlertCircle, CheckCircle2, Wrench, XCircle } from "lucide-react";
import { getPublicStatus, type ComponentState, type PublicStatus } from "@gumakart/db";
import { Card, CardContent } from "@/components/ui/card";
import { Breadcrumb, ContentSection, MarketingShell, PageHeader } from "@/components/landing/marketing-shell";

export const metadata: Metadata = {
  title: "System Status — Guma Kart",
  description: "Is Guma Kart working? Live status of checkout, the seller dashboard, POS, SMS, payments and channels.",
};

// Always live (never baked in at build time, when there is no database).
export const dynamic = "force-dynamic";

const META: Record<ComponentState, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  operational: { label: "Gumagana", className: "text-emerald-600", Icon: CheckCircle2 },
  maintenance: { label: "Maintenance", className: "text-sky-600", Icon: Wrench },
  degraded: { label: "Mabagal / delayed", className: "text-amber-600", Icon: AlertCircle },
  partial_outage: { label: "May sira", className: "text-orange-600", Icon: AlertCircle },
  major_outage: { label: "Down", className: "text-red-600", Icon: XCircle },
};

const HEADLINE: Record<ComponentState, string> = {
  operational: "Lahat gumagana — all systems working",
  maintenance: "May scheduled maintenance",
  degraded: "May mabagal na bahagi — some things are delayed",
  partial_outage: "May bahaging may problema — we're on it",
  major_outage: "May malaking problema — we're on it",
};

const STATUS_WORD: Record<string, string> = {
  investigating: "Inaalam pa",
  identified: "Alam na ang dahilan",
  monitoring: "Inaayos na, binabantayan",
  resolved: "Ayos na",
};

const pht = (d: Date) => new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(d);

async function load(): Promise<PublicStatus | null> {
  try {
    return await getPublicStatus();
  } catch {
    return null; // the database itself is unreachable
  }
}

export default async function StatusPage() {
  const status = await load();
  const overall: ComponentState = status ? status.overall : "major_outage";
  const meta = META[overall];

  return (
    <MarketingShell>
      <Breadcrumb items={[{ label: "System status" }]} />
      <PageHeader eyebrow="Status" title={HEADLINE[overall]} description="Live status ng Guma Kart. Updated every minute." />
      <ContentSection>
        <div className={`mb-6 flex items-center gap-2 text-sm font-medium ${meta.className}`} data-testid="status-overall">
          <meta.Icon className="h-4 w-4" />
          {status ? `Last checked ${pht(status.updatedAt)} (PHT)` : "We can't reach our database right now. Your data is safe — we're working on it."}
        </div>

        {status?.active.map((i) => (
          <Card key={i.id} className="mb-4 border-amber-300/60 bg-amber-50/60">
            <CardContent className="py-4">
              <p className="font-semibold text-foreground">{i.title}</p>
              <ol className="mt-2 space-y-1.5 text-sm">
                {i.updates.map((u, idx) => (
                  <li key={idx}>
                    <span className="font-medium">{STATUS_WORD[u.status] ?? u.status}</span> — {u.message}{" "}
                    <span className="text-xs text-muted-foreground">({pht(u.createdAt)})</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ))}

        <div className="space-y-2" data-testid="status-components">
          {(status?.components ?? []).map((c) => {
            const m = META[c.state];
            return (
              <Card key={c.id} className="border-border/60">
                <CardContent className="flex items-center justify-between py-4">
                  <span className="text-sm font-medium text-foreground">{c.label}</span>
                  <span className={`flex items-center gap-1.5 text-xs font-medium ${m.className}`}>
                    <m.Icon className="h-3.5 w-3.5" />
                    {m.label}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <h2 className="mt-10 text-base font-semibold text-foreground">Nakaraang 30 araw</h2>
        {status && status.history.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {status.history.map((i) => (
              <li key={i.id} className="rounded-2xl border border-border/60 p-4 text-sm">
                <p className="font-medium text-foreground">{i.title}</p>
                <p className="text-xs text-muted-foreground">
                  {pht(i.createdAt)} — ayos na {i.resolvedAt ? pht(i.resolvedAt) : ""}
                </p>
                {i.updates[0] && <p className="mt-1 text-muted-foreground">{i.updates[0].message}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Walang naitalang problema. No incidents in the last 30 days.</p>
        )}

        <div className="mt-8 rounded-2xl border border-border/60 bg-muted/30 p-5 text-sm">
          <p className="font-medium text-foreground">May problema na wala dito?</p>
          <p className="mt-1 text-muted-foreground">
            Sellers: open Help → Contact support in your dashboard, or email{" "}
            <a href="mailto:support@guma.one" className="text-primary hover:underline">
              support@guma.one
            </a>
            .
          </p>
        </div>
      </ContentSection>
    </MarketingShell>
  );
}
