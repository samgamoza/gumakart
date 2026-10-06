"use client";

import { useEffect, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, formatPrice } from "@gumakart/ui";
import type { RevenueForecast } from "@gumakart/db";

/**
 * Phase 33 (H10): "Next 30 days" as a range, only once the shop has 3 months of sales.
 * Wording stays honest: a likely range from past weeks, not a promise.
 */
export function ForecastCard() {
  const [f, setF] = useState<RevenueForecast | null>(null);
  useEffect(() => {
    void fetch("/api/insights/forecast", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => d.ok && setF(d.forecast))
      .catch(() => undefined);
  }, []);
  if (!f) return null;

  return (
    <div data-testid="forecast-card">
      <Card className="p-5">
        <p className="text-sm font-semibold">Next 30 days</p>
        {!f.ready ? (
          <p className="mt-1 text-sm text-muted-foreground">
            A sales range shows here once your shop has {f.needDays} days of orders ({Math.max(0, f.needDays - f.historyDays)} to go).
          </p>
        ) : (
          <>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">
              {formatPrice(f.low)} – {formatPrice(f.high)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Likely range from your last {f.basisWeeks} weeks (about 8 in 10 months land inside). Last 30 days: {formatPrice(f.last30)}.
            </p>
            {f.trendPct != null && f.trendPct !== 0 && (
              <p className={`mt-2 flex items-center gap-1 text-xs ${f.trendPct > 0 ? "text-emerald-500" : "text-orange-500"}`}>
                {f.trendPct > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                Last 4 weeks are {Math.abs(f.trendPct)}% {f.trendPct > 0 ? "above" : "below"} the 8 before.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
