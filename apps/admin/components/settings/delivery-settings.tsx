"use client";

import { useEffect, useMemo, useState } from "react";
import { SettingsShell } from "@/components/settings/settings-shell";
import {
  SettingsActions,
  SettingsCard,
  SettingsField,
  inputClassName,
  textareaClassName,
  useTenantSettings,
} from "@/components/settings/settings-forms";

type AreaKey = "metro_manila" | "luzon" | "visayas" | "mindanao";
const AREAS: Array<[AreaKey, string]> = [
  ["metro_manila", "Metro Manila"],
  ["luzon", "Rest of Luzon"],
  ["visayas", "Visayas"],
  ["mindanao", "Mindanao"],
];

function previewDeliveryFee(subtotal: number, flatRate: number, freeDeliveryMin: number): number {
  if (freeDeliveryMin > 0 && subtotal >= freeDeliveryMin) return 0;
  return flatRate;
}

function providerLabel(provider: string): string {
  if (provider === "lalamove") return "Lalamove delivery";
  if (provider === "grab") return "GrabExpress delivery";
  return "Delivery fee";
}

export function DeliverySettingsPage() {
  const { settings, loading, saving, error, saved, save } = useTenantSettings();
  const [codEnabled, setCodEnabled] = useState(true);
  const [autoAcceptOrders, setAutoAcceptOrders] = useState(false);
  const [minOrderAmount, setMinOrderAmount] = useState("99");
  const [provider, setProvider] = useState("manual");
  const [flatRate, setFlatRate] = useState("0");
  const [freeDeliveryMin, setFreeDeliveryMin] = useState("500");
  const [pickupEnabled, setPickupEnabled] = useState(true);
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  /** Phase 24: own-delivery fee per area ("" = use the flat fee). */
  const [areaRates, setAreaRates] = useState<Record<AreaKey, string>>({ metro_manila: "", luzon: "", visayas: "", mindanao: "" });

  useEffect(() => {
    if (!settings) return;
    setCodEnabled(settings.settings.codEnabled ?? true);
    setAutoAcceptOrders(settings.settings.autoAcceptOrders ?? false);
    setMinOrderAmount(String(settings.settings.minOrderAmount ?? 99));
    setProvider(settings.settings.delivery?.provider ?? "manual");
    setFlatRate(String(settings.settings.delivery?.flatRate ?? 0));
    setFreeDeliveryMin(String(settings.settings.delivery?.freeDeliveryMin ?? 500));
    setPickupEnabled(settings.settings.delivery?.pickupEnabled ?? true);
    setDeliveryNotes(settings.settings.delivery?.deliveryNotes ?? "");
    setPickupAddress(settings.settings.delivery?.pickupAddress ?? "");
    const ar = settings.settings.delivery?.areaRates ?? {};
    setAreaRates({
      metro_manila: ar.metro_manila != null ? String(ar.metro_manila) : "",
      luzon: ar.luzon != null ? String(ar.luzon) : "",
      visayas: ar.visayas != null ? String(ar.visayas) : "",
      mindanao: ar.mindanao != null ? String(ar.mindanao) : "",
    });
  }, [settings]);

  const previewSubtotal = 499;
  const previewFee = useMemo(
    () =>
      previewDeliveryFee(
        previewSubtotal,
        Number(flatRate) || 0,
        Number(freeDeliveryMin) || 0
      ),
    [flatRate, freeDeliveryMin]
  );

  if (loading) {
    return (
      <SettingsShell title="Delivery & Shipping" description="Loading…">
        …
      </SettingsShell>
    );
  }

  return (
    <SettingsShell
      title="Delivery & Shipping"
      description="Configure how customers pay and receive orders."
    >
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="space-y-4">
        <SettingsCard title="Checkout preview">
          <p className="text-sm text-muted-foreground">
            Based on a sample order of ₱{previewSubtotal}, customers will see:
          </p>
          <ul className="mt-3 space-y-2 text-sm text-foreground">
            <li>
              • {codEnabled ? "COD available" : "COD hidden"} · Min order ₱
              {Number(minOrderAmount) || 0}
            </li>
            <li>
              • {providerLabel(provider)}: ₱{previewFee}
              {previewFee === 0 && Number(freeDeliveryMin) > 0
                ? ` (free above ₱${freeDeliveryMin})`
                : ""}
            </li>
            <li>• {pickupEnabled ? "Store pickup offered" : "Delivery only"}</li>
            {deliveryNotes && <li>• Note: {deliveryNotes}</li>}
          </ul>
        </SettingsCard>

        <SettingsCard title="Payments & orders">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={codEnabled} onChange={(e) => setCodEnabled(e.target.checked)} />
            Accept Cash on Delivery (COD)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoAcceptOrders}
              onChange={(e) => setAutoAcceptOrders(e.target.checked)}
            />
            Auto-accept new orders
          </label>
          <SettingsField label="Minimum order amount (₱)">
            <input
              type="number"
              min="0"
              className={inputClassName()}
              value={minOrderAmount}
              onChange={(e) => setMinOrderAmount(e.target.value)}
            />
          </SettingsField>
        </SettingsCard>

        <SettingsCard title="Delivery">
          <SettingsField label="Delivery provider">
            <select
              className={inputClassName()}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="manual">Manual / in-house</option>
              <option value="lalamove">Lalamove</option>
              <option value="grab">GrabExpress</option>
            </select>
          </SettingsField>
          {(provider === "lalamove" || provider === "grab") && (
            <SettingsField label="Store pickup address (for courier quotes)">
              <textarea
                className={textareaClassName()}
                rows={2}
                value={pickupAddress}
                onChange={(e) => setPickupAddress(e.target.value)}
                placeholder="123 Kalayaan Ave, Brgy. Central, Quezon City"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Customers get live {provider === "grab" ? "GrabExpress" : "Lalamove"} quotes from
                this address (with automatic failover to the other connected courier when
                available). Leave blank to use the flat fee below.
              </p>
            </SettingsField>
          )}
          {provider === "manual" && (
            <p className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Manual mode: use flat fee at checkout, then assign Angkas / Move It / own riders
              from Orders → Assign rider. You can still tap “Book rider” to record a self-delivery
              booking.
            </p>
          )}
          <SettingsField label="Flat delivery fee (₱)">
            <input
              type="number"
              min="0"
              className={inputClassName()}
              value={flatRate}
              onChange={(e) => setFlatRate(e.target.value)}
            />
          </SettingsField>
          {provider === "manual" && (
            <div className="rounded-xl border border-border/60 p-3" data-testid="area-rates">
              <p className="text-sm font-medium">Fee by area (optional)</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                For J&amp;T, LBC, Flash or Ninja Van pricing. Leave blank to use the flat fee there. Based on the buyer&apos;s
                province at checkout; anywhere not listed pays the flat fee.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {AREAS.map(([key, label]) => (
                  <label key={key} className="block text-xs text-muted-foreground">
                    {label}
                    <input
                      type="number"
                      min="0"
                      inputMode="decimal"
                      placeholder={flatRate || "0"}
                      className={`${inputClassName()} mt-1`}
                      value={areaRates[key]}
                      onChange={(e) => setAreaRates((r) => ({ ...r, [key]: e.target.value }))}
                      data-testid={`area-${key}`}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
          <SettingsField label="Free delivery above (₱)" hint="0 = never free. Buyers see “Add ₱X more for free delivery” in the cart and checkout, and it applies even when Lalamove/Grab quotes a price (you cover the courier).">
            <input
              type="number"
              min="0"
              className={inputClassName()}
              value={freeDeliveryMin}
              onChange={(e) => setFreeDeliveryMin(e.target.value)}
            />
          </SettingsField>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pickupEnabled}
              onChange={(e) => setPickupEnabled(e.target.checked)}
            />
            Allow store pickup
          </label>
          <SettingsField label="Delivery notes for customers">
            <textarea
              className={textareaClassName()}
              rows={3}
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              placeholder="Metro Manila only · 1–3 PM delivery window"
            />
          </SettingsField>
        </SettingsCard>

        <SettingsActions
          saving={saving}
          saved={saved}
          onSave={() =>
            save({
              settings: {
                codEnabled,
                autoAcceptOrders,
                minOrderAmount: Number(minOrderAmount) || 0,
                delivery: {
                  provider: provider as "lalamove" | "grab" | "manual",
                  flatRate: Number(flatRate) || 0,
                  freeDeliveryMin: Number(freeDeliveryMin) || 0,
                  pickupEnabled,
                  deliveryNotes,
                  pickupAddress,
                  areaRates: Object.fromEntries(
                    AREAS.filter(([k]) => areaRates[k].trim() !== "" && Number.isFinite(Number(areaRates[k]))).map(([k]) => [k, Number(areaRates[k])])
                  ),
                },
              },
            })
          }
        />
      </div>
    </SettingsShell>
  );
}
