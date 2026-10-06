"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, ExternalLink } from "lucide-react";
import type { ActiveLanding } from "@gumakart/db";
import { setActiveLandingAction } from "@/app/actions";

const OPTIONS: {
  id: ActiveLanding;
  name: string;
  desc: string;
  previewPath: string;
}[] = [
  {
    id: "frontend1",
    name: "GumaKart",
    desc: "The GumaKart marketing landing — emerald theme, storefront & checkout focus.",
    previewPath: "/frontend1",
  },
  {
    id: "frontend2",
    name: "Guma One.ai",
    desc: "The Guma One.ai landing — dark, animated, anti-“PM sent” social-commerce story.",
    previewPath: "/guma-one-ai",
  },
  {
    id: "frontend3",
    name: "Palenke AI",
    desc: "The Palenke AI landing — bright violet SaaS look, chat-to-checkout story, interactive checkout demo.",
    previewPath: "/palenke-ai",
  },
];

export function FrontendSwitcher({
  active,
  webUrl,
}: {
  active: ActiveLanding;
  webUrl: string;
}) {
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState<ActiveLanding>(active);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function choose(next: ActiveLanding) {
    if (next === current || pending) return;
    const prev = current;
    setCurrent(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setActiveLandingAction(next);
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      } else {
        setError(res.error ?? "Failed to update.");
        setCurrent(prev);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {saved && (
          <span className="flex items-center gap-1 text-emerald-600">
            <Check className="h-4 w-4" /> Live now
          </span>
        )}
        {error && <span className="text-rose-600">{error}</span>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {OPTIONS.map((opt) => {
          const isActive = current === opt.id;
          return (
            <div
              key={opt.id}
              className={`relative rounded-2xl border p-5 transition ${
                isActive
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold tracking-tight">{opt.name}</h3>
                {isActive && (
                  <span className="rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                    Live
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">{opt.desc}</p>

              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => choose(opt.id)}
                  disabled={isActive || pending}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:cursor-default ${
                    isActive
                      ? "bg-muted text-muted-foreground"
                      : "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  }`}
                >
                  {isActive ? "Currently live" : "Make live"}
                </button>
                <a
                  href={`${webUrl}${opt.previewPath}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:border-primary/40"
                >
                  Preview <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        The public homepage at{" "}
        <a href={webUrl} target="_blank" rel="noreferrer" className="underline hover:text-primary">
          {webUrl}
        </a>{" "}
        renders the live choice immediately.
      </p>
    </div>
  );
}
