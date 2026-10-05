"use client";

import { useCallback, useEffect, useState } from "react";
import type { KartAddress } from "@/lib/kart/ph-address";

export interface GumaIdBuyer {
  phone: string;
  name: string | null;
  email: string | null;
  preferredPayment: string | null;
}

export interface GumaIdAddress {
  id: string;
  label: string | null;
  recipient: string | null;
  address: Partial<KartAddress> & { line1: string };
  isDefault: boolean;
}

export interface GumaIdState {
  loaded: boolean;
  available: boolean;
  buyer: GumaIdBuyer | null;
  addresses: GumaIdAddress[];
  refresh: () => Promise<void>;
}

/** Phase 12: who's signed in to Guma ID (null when signed out or not switched on). */
export function useGumaId(): GumaIdState {
  const [state, setState] = useState<Omit<GumaIdState, "refresh">>({ loaded: false, available: false, buyer: null, addresses: [] });
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/id/me", { cache: "no-store" });
      const d = (await res.json()) as { ok: boolean; available?: boolean; buyer?: GumaIdBuyer | null; addresses?: GumaIdAddress[] };
      setState({ loaded: true, available: Boolean(d.available), buyer: d.buyer ?? null, addresses: d.addresses ?? [] });
    } catch {
      setState({ loaded: true, available: false, buyer: null, addresses: [] });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { ...state, refresh };
}

export function toKartAddress(a: GumaIdAddress["address"]): KartAddress {
  return {
    line1: a.line1 ?? "",
    regionCode: a.regionCode ?? "",
    region: a.region ?? "",
    provinceCode: a.provinceCode ?? "",
    province: a.province ?? "",
    cityCode: a.cityCode ?? "",
    city: a.city ?? "",
    barangay: a.barangay ?? "",
    landmark: a.landmark ?? "",
  };
}

export function maskPhone(p: string): string {
  return p.length === 11 ? `${p.slice(0, 4)} ••• ${p.slice(-4)}` : p;
}
