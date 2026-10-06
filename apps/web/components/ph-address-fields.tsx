"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Loader2, MapPin } from "lucide-react";

export type PhAddressValue = {
  street1: string;
  /** Optional subdivision / village / building line */
  street2: string;
  barangay: string;
  city: string;
  province: string;
  provinceCode: string;
  cityCode: string;
};

type Suggestion = {
  psgcCode: string;
  name: string;
  kind: "province" | "city" | "barangay";
  provinceCode: string;
  provinceName: string;
  cityCode: string | null;
  cityName: string | null;
};

function normalizeMatch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ñ/g, "n")
    .replace(/\bcity of\b/g, "")
    .replace(/\bcity\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findBestMatch(options: Suggestion[], typed: string): Suggestion | null {
  const q = normalizeMatch(typed);
  if (!q) return null;
  const exact = options.find((item) => normalizeMatch(item.name) === q);
  if (exact) return exact;
  const starts = options.find((item) => normalizeMatch(item.name).startsWith(q));
  if (starts) return starts;
  const contains = options.find((item) => normalizeMatch(item.name).includes(q));
  return contains ?? null;
}

function SuggestField({
  label,
  placeholder,
  value,
  disabled,
  loading,
  options,
  error,
  inputName,
  autoComplete,
  onFocusFetch,
  onChangeText,
  onPick,
  onBlurResolve,
}: {
  label: string;
  placeholder: string;
  value: string;
  disabled?: boolean;
  loading?: boolean;
  options: Suggestion[];
  error?: string | null;
  inputName?: string;
  autoComplete?: string;
  onFocusFetch: () => void;
  onChangeText: (value: string) => void;
  onPick: (item: Suggestion) => void;
  onBlurResolve?: () => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        <input
          name={inputName}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={autoComplete ?? "off"}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          onFocus={() => {
            setOpen(true);
            onFocusFetch();
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setOpen(false);
              onBlurResolve?.();
            }, 150);
          }}
          onChange={(event) => {
            onChangeText(event.target.value);
            setOpen(true);
          }}
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 pr-9 text-sm text-stone-900 placeholder:text-slate-400 outline-none focus:border-[var(--shop-accent,#7c3aed)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--shop-accent,#7c3aed)_22%,transparent)] disabled:opacity-50"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      </div>
      {open && !disabled && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-border/70 bg-white py-1 shadow-lg"
        >
          {options.map((item) => (
            <li key={item.psgcCode}>
              <button
                type="button"
                role="option"
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-emerald-50"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onPick(item);
                  setOpen(false);
                }}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span>
                  <span className="font-medium text-neutral-900">{item.name}</span>
                  {item.kind !== "province" && (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {[item.cityName, item.provinceName].filter(Boolean).join(", ")}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

async function fetchSuggestions(
  kind: "province" | "city" | "barangay",
  q: string,
  codes?: { provinceCode?: string; cityCode?: string }
): Promise<Suggestion[]> {
  const params = new URLSearchParams({ type: kind });
  if (q.trim()) params.set("q", q.trim());
  if (codes?.provinceCode) params.set("provinceCode", codes.provinceCode);
  if (codes?.cityCode) params.set("cityCode", codes.cityCode);
  const res = await fetch(`/api/locations?${params.toString()}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: Suggestion[] };
  return data.results ?? [];
}

export function PhAddressFields({
  value,
  onChange,
  errors,
  showErrors,
}: {
  value: PhAddressValue;
  onChange: (next: PhAddressValue) => void;
  errors?: Partial<Record<keyof PhAddressValue, string | null>>;
  showErrors?: boolean;
}) {
  const valueRef = useRef(value);
  valueRef.current = value;

  const [provinceOpts, setProvinceOpts] = useState<Suggestion[]>([]);
  const [cityOpts, setCityOpts] = useState<Suggestion[]>([]);
  const [barangayOpts, setBarangayOpts] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState<{
    province?: boolean;
    city?: boolean;
    barangay?: boolean;
  }>({});

  const provinceReady = Boolean(value.province.trim());
  const cityReady = Boolean(value.city.trim() && provinceReady);

  /** Resolve PSGC codes after browser autofill fills names without picking from our list. */
  async function resolveCodes(next: PhAddressValue = valueRef.current): Promise<PhAddressValue> {
    let resolved = { ...next };

    if (resolved.province.trim() && !resolved.provinceCode) {
      const provinces = await fetchSuggestions("province", resolved.province);
      setProvinceOpts(provinces);
      const match = findBestMatch(provinces, resolved.province);
      if (match) {
        resolved = {
          ...resolved,
          province: match.name,
          provinceCode: match.provinceCode,
        };
      }
    }

    if (resolved.provinceCode && resolved.city.trim() && !resolved.cityCode) {
      const cities = await fetchSuggestions("city", resolved.city, {
        provinceCode: resolved.provinceCode,
      });
      setCityOpts(cities);
      const match = findBestMatch(cities, resolved.city);
      if (match) {
        resolved = {
          ...resolved,
          city: match.name,
          cityCode: match.cityCode ?? "",
        };
      }
    }

    return resolved;
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading((s) => ({ ...s, province: true }));
      void fetchSuggestions("province", value.province)
        .then(async (opts) => {
          setProvinceOpts(opts);
          // Autofill / typed province without a pick → attach provinceCode
          if (value.province.trim() && !value.provinceCode) {
            const match = findBestMatch(opts, value.province);
            if (match) {
              onChange({
                ...valueRef.current,
                province: match.name,
                provinceCode: match.provinceCode,
              });
            }
          }
        })
        .finally(() => setLoading((s) => ({ ...s, province: false })));
    }, 200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync on typed province only
  }, [value.province]);

  useEffect(() => {
    if (!value.provinceCode) {
      // Still try resolving province from name (browser autofill path)
      if (value.province.trim()) {
        const timer = window.setTimeout(() => {
          void resolveCodes().then((resolved) => {
            if (
              resolved.provinceCode !== value.provinceCode ||
              resolved.cityCode !== value.cityCode
            ) {
              onChange(resolved);
            }
          });
        }, 250);
        return () => window.clearTimeout(timer);
      }
      setCityOpts([]);
      return;
    }

    const timer = window.setTimeout(() => {
      setLoading((s) => ({ ...s, city: true }));
      void fetchSuggestions("city", value.city, { provinceCode: value.provinceCode })
        .then((opts) => {
          setCityOpts(opts);
          if (value.city.trim() && !value.cityCode) {
            const match = findBestMatch(opts, value.city);
            if (match) {
              onChange({
                ...valueRef.current,
                city: match.name,
                cityCode: match.cityCode ?? "",
              });
            }
          }
        })
        .finally(() => setLoading((s) => ({ ...s, city: false })));
    }, 200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.city, value.provinceCode]);

  useEffect(() => {
    if (!value.provinceCode || !value.cityCode) {
      setBarangayOpts([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading((s) => ({ ...s, barangay: true }));
      void fetchSuggestions("barangay", value.barangay, {
        provinceCode: value.provinceCode,
        cityCode: value.cityCode,
      })
        .then(setBarangayOpts)
        .finally(() => setLoading((s) => ({ ...s, barangay: false })));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [value.barangay, value.provinceCode, value.cityCode]);

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Street address
        </label>
        <input
          name="address-line1"
          placeholder="House no., street, building"
          value={value.street1}
          onChange={(event) => onChange({ ...value, street1: event.target.value })}
          autoComplete="address-line1"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-stone-900 placeholder:text-slate-400 outline-none focus:border-[var(--shop-accent,#7c3aed)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--shop-accent,#7c3aed)_22%,transparent)]"
        />
        {showErrors && errors?.street1 ? (
          <p className="mt-1 text-xs text-red-600">{errors.street1}</p>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Address 2 <span className="font-normal">(optional)</span>
        </label>
        <input
          name="address-line2"
          placeholder="Subdivision, village, building, unit"
          value={value.street2}
          onChange={(event) => onChange({ ...value, street2: event.target.value })}
          autoComplete="address-line2"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-stone-900 placeholder:text-slate-400 outline-none focus:border-[var(--shop-accent,#7c3aed)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--shop-accent,#7c3aed)_22%,transparent)]"
        />
      </div>

      <SuggestField
        label="Province / HUC"
        placeholder="Start typing province (e.g. Cavite, Quezon City)"
        value={value.province}
        loading={loading.province}
        options={provinceOpts}
        error={showErrors ? errors?.province : null}
        inputName="address-level1"
        autoComplete="address-level1"
        onFocusFetch={() => {
          setLoading((s) => ({ ...s, province: true }));
          void fetchSuggestions("province", value.province)
            .then(setProvinceOpts)
            .finally(() => setLoading((s) => ({ ...s, province: false })));
        }}
        onBlurResolve={() => {
          void resolveCodes().then((resolved) => {
            if (
              resolved.provinceCode !== valueRef.current.provinceCode ||
              resolved.province !== valueRef.current.province
            ) {
              onChange(resolved);
            }
          });
        }}
        onChangeText={(province) =>
          onChange({
            ...value,
            province,
            provinceCode: "",
            city: "",
            cityCode: "",
            barangay: "",
          })
        }
        onPick={(item) =>
          onChange({
            ...value,
            province: item.name,
            provinceCode: item.provinceCode,
            city: "",
            cityCode: "",
            barangay: "",
          })
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SuggestField
          label="Town / City"
          placeholder={provinceReady ? "Start typing city" : "Enter province first"}
          value={value.city}
          disabled={!provinceReady}
          loading={loading.city}
          options={cityOpts}
          error={showErrors ? errors?.city : null}
          inputName="address-level2"
          autoComplete="address-level2"
          onFocusFetch={() => {
            void resolveCodes().then(async (resolved) => {
              if (resolved.provinceCode !== value.provinceCode) onChange(resolved);
              if (!resolved.provinceCode) return;
              setLoading((s) => ({ ...s, city: true }));
              const opts = await fetchSuggestions("city", resolved.city || value.city, {
                provinceCode: resolved.provinceCode,
              });
              setCityOpts(opts);
              setLoading((s) => ({ ...s, city: false }));
            });
          }}
          onBlurResolve={() => {
            void resolveCodes().then((resolved) => {
              if (
                resolved.cityCode !== valueRef.current.cityCode ||
                resolved.city !== valueRef.current.city ||
                resolved.provinceCode !== valueRef.current.provinceCode
              ) {
                onChange(resolved);
              }
            });
          }}
          onChangeText={(city) =>
            onChange({
              ...value,
              city,
              cityCode: "",
              barangay: "",
            })
          }
          onPick={(item) =>
            onChange({
              ...value,
              city: item.name,
              cityCode: item.cityCode ?? "",
              barangay: "",
            })
          }
        />

        <SuggestField
          label="Barangay"
          placeholder={cityReady ? "Start typing barangay" : "Enter city first"}
          value={value.barangay}
          disabled={!cityReady}
          loading={loading.barangay}
          options={barangayOpts}
          error={showErrors ? errors?.barangay : null}
          autoComplete="off"
          onFocusFetch={() => {
            void resolveCodes().then(async (resolved) => {
              if (
                resolved.provinceCode !== value.provinceCode ||
                resolved.cityCode !== value.cityCode
              ) {
                onChange(resolved);
              }
              if (!resolved.provinceCode || !resolved.cityCode) return;
              setLoading((s) => ({ ...s, barangay: true }));
              const opts = await fetchSuggestions("barangay", value.barangay, {
                provinceCode: resolved.provinceCode,
                cityCode: resolved.cityCode,
              });
              setBarangayOpts(opts);
              setLoading((s) => ({ ...s, barangay: false }));
            });
          }}
          onChangeText={(barangay) => onChange({ ...value, barangay })}
          onPick={(item) => onChange({ ...value, barangay: item.name })}
        />
      </div>
    </div>
  );
}

export function composePhDeliveryAddress(value: PhAddressValue): string {
  return [
    value.street1,
    value.street2,
    value.barangay,
    value.city,
    value.province,
    "Philippines",
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}
