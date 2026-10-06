"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PackageSearch } from "lucide-react";
import { Card } from "@gumakart/ui";

interface Item {
  variantId: string;
  productId: string;
  title: string;
  stock: number;
  sold: number;
  perDay: number;
  daysLeft: number | null;
  suggestedQty: number;
}

/**
 * Phase 26: "Paubos na" — items that will run out within two weeks at the last 30 days' pace,
 * with how many to reorder for two more weeks. Plain arithmetic, no AI. Hidden when empty.
 */
export function RestockCard() {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    fetch("/api/insights/restock", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setItems(d.ok ? d.items : []))
      .catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) return null;
  return (
    <Card className="border-white/10 bg-white/[0.03]" data-testid="restock-card">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/15">
          <PackageSearch className="h-4 w-4 text-amber-300" />
        </span>
        <div>
          <p className="text-sm font-semibold text-white">Paubos na — restock soon</p>
          <p className="text-xs text-slate-400">At your last 30 days' pace. Order amounts cover two more weeks.</p>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-white/5 text-sm">
        {items.slice(0, 6).map((i) => (
          <li key={i.variantId} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-slate-200">{i.title}</p>
              <p className="text-xs text-slate-500">
                {i.stock} left · {i.sold} sold in 30 days
              </p>
            </div>
            <div className="flex-none text-right">
              <p className={`text-xs font-semibold ${i.daysLeft === 0 ? "text-rose-300" : i.daysLeft != null && i.daysLeft <= 3 ? "text-amber-300" : "text-slate-300"}`}>
                {i.daysLeft === 0 ? "Out now" : `~${i.daysLeft} day${i.daysLeft === 1 ? "" : "s"} left`}
              </p>
              {i.suggestedQty > 0 && <p className="text-xs text-slate-500">Order ~{i.suggestedQty}</p>}
            </div>
          </li>
        ))}
      </ul>
      <Link href="/inventory" className="mt-2 inline-block text-xs text-slate-400 hover:text-white">
        Update stock →
      </Link>
    </Card>
  );
}
