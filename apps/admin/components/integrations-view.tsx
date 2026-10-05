"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Card } from "@gumakart/ui";

/** Phase 15 — Apps & integrations: one place to see what's connected and set up the rest. */

type Status = "on" | "available" | "waiting" | "via_api";

interface Item {
  id: string;
  name: string;
  description: string;
  status: Status;
  detail?: string;
  href: string;
  ownerOnly?: boolean;
}

const BADGE: Record<Status, { label: string; cls: string }> = {
  on: { label: "On", cls: "bg-emerald-500/15 text-emerald-200" },
  available: { label: "Ready to set up", cls: "bg-violet-500/15 text-violet-200" },
  waiting: { label: "Coming soon", cls: "bg-white/10 text-muted-foreground" },
  via_api: { label: "Through webhooks / API", cls: "bg-sky-500/15 text-sky-200" },
};

export function IntegrationsView() {
  const [groups, setGroups] = useState<Array<{ id: string; label: string; items: Item[] }> | null>(null);
  const [owner, setOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/integrations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ok: boolean; groups: Array<{ id: string; label: string; items: Item[] }>; owner: boolean; error?: string }) => {
        if (d.ok) {
          setGroups(d.groups);
          setOwner(d.owner);
        } else setError(d.error ?? "Could not load.");
      });
  }, []);

  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (!groups)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );

  const on = groups.flatMap((g) => g.items).filter((i) => i.status === "on").length;
  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-24">
      <p className="text-sm text-muted-foreground">
        {on} connected. &ldquo;Coming soon&rdquo; ones are built and switch on as soon as Guma Kart&apos;s accounts with those providers are approved — nothing to do on your side.
        Anything else connects through webhooks and the API.
      </p>
      {groups.map((g) => (
        <section key={g.id}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((item) => {
              const locked = item.ownerOnly && !owner;
              const badge = BADGE[item.status];
              const body = (
                <Card className={`flex h-full flex-col p-4 ${locked ? "opacity-60" : "transition-colors hover:border-violet-400/40"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{item.name}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <p className="mt-1 flex-1 text-xs text-muted-foreground">{item.description}</p>
                  {item.detail && <p className="mt-2 text-xs">{item.detail}</p>}
                  <p className="mt-3 flex items-center gap-1 text-xs text-violet-300">
                    {locked ? "Owner only" : item.status === "on" ? "Manage" : item.status === "waiting" ? "See details" : "Set up"}
                    {!locked && <ArrowRight className="h-3 w-3" />}
                  </p>
                </Card>
              );
              return locked ? (
                <div key={item.id} data-testid="integration-card">
                  {body}
                </div>
              ) : (
                <Link key={item.id} href={item.href} data-testid="integration-card">
                  {body}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
