"use client";

import { useMemo, useState } from "react";
import {
  emojiForGuideCategory,
  groupCategoriesForOnboarding,
  matchBusinessCategories,
} from "@gumakart/storefront-themes";

/** Most common FB / Shopee / Lazada seller starts — short shortcuts only. */
const QUICK_PICKS = [
  "Food & Beverage",
  "Fashion & Apparel",
  "Beauty & Skincare",
  "Grocery & Supermarket",
  "Home Services & Trades",
] as const;

export function BusinessCategoryPicker({
  value,
  onChange,
  allowedCategories,
  id = "category",
}: {
  value: string;
  onChange: (category: string) => void;
  allowedCategories: string[];
  id?: string;
}) {
  const [filter, setFilter] = useState("");

  const groups = useMemo(
    () => groupCategoriesForOnboarding(allowedCategories),
    [allowedCategories]
  );

  const quickPicks = useMemo(
    () => QUICK_PICKS.filter((label) => allowedCategories.includes(label)),
    [allowedCategories]
  );

  const filterHits = useMemo(() => {
    const q = filter.trim();
    if (q.length < 1) return [];
    return matchBusinessCategories(q, {
      allowedLabels: allowedCategories,
      limit: 8,
      minScore: 40,
    });
  }, [filter, allowedCategories]);

  const showFilterResults = filter.trim().length >= 1;

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-foreground">
          Business category
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Same idea as Facebook, Shopee, or Lazada — pick the category you already use.
        </p>
      </div>

      {quickPicks.length > 0 && !showFilterResults && (
        <div className="flex flex-wrap gap-2">
          {quickPicks.map((label) => {
            const active = value === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => onChange(label)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                  active
                    ? "border-emerald-700 bg-emerald-700 text-white"
                    : "border-border bg-card text-foreground hover:border-emerald-400"
                }`}
              >
                {emojiForGuideCategory(label)} {label}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
      <input
        id={`${id}-filter`}
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Find category…"
        className="h-12 w-full rounded-xl border border-border bg-background px-3.5 text-[15px] outline-none ring-emerald-500/30 placeholder:text-muted-foreground focus:border-emerald-500 focus:ring-2"
        autoComplete="off"
        aria-label="Search categories"
      />

      {showFilterResults ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {filterHits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No match — clear the search and pick from the list below.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filterHits.map((m) => (
                <li key={m.label}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(m.label);
                      setFilter("");
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-emerald-50 ${
                      value === m.label ? "bg-emerald-50 font-semibold" : "font-medium"
                    }`}
                  >
                    <span aria-hidden>{emojiForGuideCategory(m.label)}</span>
                    <span>{m.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <select
        id={id}
        name="category"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full rounded-xl border border-border bg-background px-3.5 text-[15px] text-foreground outline-none ring-emerald-500/30 focus:border-emerald-500 focus:ring-2"
      >
        <option value="">Choose your category…</option>
        {groups.map(({ group, entries }) => (
          <optgroup key={group.id} label={group.label}>
            {entries.map((entry) => (
              <option key={entry.label} value={entry.label}>
                {entry.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      </div>

      {showFilterResults ? null : value ? (
        <p className="text-xs text-muted-foreground">Selected: <span className="font-medium text-foreground">{value}</span></p>
      ) : null}
    </div>
  );
}
