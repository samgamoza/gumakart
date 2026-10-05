"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, LifeBuoy, Search } from "lucide-react";
import { Card } from "@gumakart/ui";
import { searchHelp } from "@/lib/help-articles";

export function HelpCenter({ statusUrl }: { statusUrl: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const results = useMemo(() => searchHelp(q), [q]);
  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-24">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input className="guma-field h-11 w-full pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hanapin: gcash, rider, coupon, stock…" aria-label="Search help" data-testid="help-search" />
      </div>
      <ul className="space-y-2" data-testid="help-list">
        {results.map((a) => (
          <li key={a.id}>
            <Card className="p-0">
              <button type="button" className="w-full p-4 text-left" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
                <p className="font-medium">{a.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.summary}</p>
              </button>
              {open === a.id && (
                <div className="border-t border-white/10 px-4 pb-4 pt-3">
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                    {a.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                  {a.href && (
                    <Link href={a.href} className="mt-3 inline-flex items-center gap-1 text-sm text-violet-300 hover:underline">
                      {a.linkLabel ?? "Open"} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              )}
            </Card>
          </li>
        ))}
        {results.length === 0 && <p className="text-sm text-muted-foreground">Walang tugma. Try another word, or contact support below.</p>}
      </ul>
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <LifeBuoy className="h-5 w-5 text-violet-300" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Kailangan pa ng tulong?</p>
          <p className="text-xs text-muted-foreground">
            Check if something is down on the{" "}
            <a href={statusUrl} target="_blank" rel="noreferrer" className="underline">
              status page
            </a>
            , or send us a ticket.
          </p>
        </div>
        <Link href="/settings/support" className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white">
          Contact support
        </Link>
      </Card>
    </div>
  );
}
