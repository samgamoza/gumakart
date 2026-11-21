"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { ADMIN_ASSIGNABLE_PLANS } from "@/lib/plans";
import { updateTenantPlanAction } from "@/app/actions";

export function PlanSelect({
  tenantId,
  name,
  plan,
}: {
  tenantId: string;
  name: string;
  plan: string;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(plan);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function change(next: string) {
    setValue(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateTenantPlanAction(tenantId, next, name);
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } else {
        setError(res.error ?? "Failed");
        setValue(plan);
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {error && <span className="text-xs text-rose-600">{error}</span>}
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {saved && <Check className="h-3.5 w-3.5 text-emerald-600" />}
      <select
        value={value}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        className="h-8 rounded-lg border border-border bg-card px-2 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50"
      >
        {ADMIN_ASSIGNABLE_PLANS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · ₱{p.priceMonthly}/mo
          </option>
        ))}
      </select>
    </div>
  );
}
