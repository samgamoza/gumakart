"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, Loader2, LogOut, MapPin, Package, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { AddressSelect } from "@/components/kart/address-select";
import { EMPTY_ADDRESS, formatAddress, isAddressComplete, type KartAddress } from "@/lib/kart/ph-address";
import { GumaIdSignIn } from "./sign-in";
import { maskPhone, toKartAddress, useGumaId } from "./use-guma-id";

/**
 * Phase 12 — Guma ID home (kart.guma.one/account): every order from every Guma Kart shop,
 * saved addresses, profile, reminder texts per shop, and privacy (export / delete).
 */

interface Order {
  id: string;
  orderNumber: string;
  shopName: string;
  shopSlug: string;
  createdAt: string;
  total: number;
  refunded: number;
  itemsSummary: string;
  bucket: string;
  orderPath: string | null;
  checkoutLinkCode: string | null;
}

interface ShopPref {
  tenantId: string;
  shopName: string;
  shopSlug: string;
  remindersOff: boolean;
}

type Tab = "orders" | "addresses" | "profile" | "privacy";

const BUCKET_TL: Record<string, { label: string; tone: string }> = {
  to_pay: { label: "Hinihintay ang bayad", tone: "bg-amber-100 text-amber-800" },
  to_confirm: { label: "Kinukumpirma ang bayad", tone: "bg-amber-100 text-amber-800" },
  to_pack: { label: "Inihahanda", tone: "bg-sky-100 text-sky-800" },
  to_ship: { label: "Ipapadala na", tone: "bg-sky-100 text-sky-800" },
  shipping: { label: "Papunta na", tone: "bg-indigo-100 text-indigo-800" },
  attention: { label: "May problema sa delivery", tone: "bg-red-100 text-red-800" },
  done: { label: "Natanggap na", tone: "bg-emerald-100 text-emerald-800" },
  cancelled: { label: "Cancelled", tone: "bg-slate-200 text-slate-700" },
  refunded: { label: "Na-refund", tone: "bg-slate-200 text-slate-700" },
};

const PAY_LABEL: Record<string, string> = { gcash: "GCash", paymaya: "Maya", cod: "Cash on delivery", bank: "Bank transfer", qrph: "QR Ph", card: "Card" };
const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, "")}`;

export function GumaIdAccount() {
  const id = useGumaId();
  const [tab, setTab] = useState<Tab>("orders");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-lg font-black tracking-tight">
            Guma <span className="text-emerald-600">ID</span>
          </Link>
          {id.buyer && (
            <span className="text-sm text-slate-500">{id.buyer.name ? `${id.buyer.name} · ` : ""}{maskPhone(id.buyer.phone)}</span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        {!id.loaded ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Sandali lang…</p>
        ) : !id.available ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h1 className="text-xl font-bold">Malapit na ang Guma ID</h1>
            <p className="mt-2 text-sm text-slate-600">
              Isang mobile number para sa lahat ng Guma Kart shops — mabilis na checkout at lahat ng order mo sa isang lugar. Hindi pa ito naka-on. Puwede ka pa ring mag-order gaya ng dati, walang account na kailangan.
            </p>
          </div>
        ) : !id.buyer ? (
          <div className="grid gap-6 md:grid-cols-[1fr_360px]">
            <div>
              <h1 className="text-2xl font-black">Lahat ng order mo, isang number lang.</h1>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                <li>✓ Auto-fill ang pangalan at address sa kahit anong Guma Kart shop</li>
                <li>✓ Makita at i-track ang lahat ng order mo, kahit iba-ibang shop</li>
                <li>✓ I-on o i-off ang reminder texts kada shop</li>
                <li>✓ Walang password — code sa text lang</li>
              </ul>
              <p className="mt-4 text-xs text-slate-500">Ang shop ay makakakita lang ng detalyeng nasa order mo sa kanila. Puwede mong i-download o burahin ang Guma ID mo kahit kailan.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <GumaIdSignIn onSignedIn={() => id.refresh()} />
            </div>
          </div>
        ) : (
          <>
            <nav className="mb-5 flex gap-2 overflow-x-auto">
              {(
                [
                  ["orders", "Mga order", Package],
                  ["addresses", "Address", MapPin],
                  ["profile", "Profile at texts", Settings],
                  ["privacy", "Privacy", ShieldCheck],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold ${tab === key ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </nav>
            {tab === "orders" ? <OrdersTab /> : tab === "addresses" ? <AddressesTab state={id} /> : tab === "profile" ? <ProfileTab state={id} /> : <PrivacyTab />}
          </>
        )}
      </main>
    </div>
  );
}

function OrdersTab() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  useEffect(() => {
    void fetch("/api/id/orders", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ok: boolean; orders?: Order[] }) => setOrders(d.orders ?? []));
  }, []);
  if (!orders) return <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Kinukuha ang mga order…</p>;
  if (orders.length === 0) return <p className="rounded-2xl bg-white p-6 text-sm text-slate-600 ring-1 ring-slate-200">Wala pang order gamit ang number na ito.</p>;
  return (
    <ul className="space-y-3" data-testid="buyer-orders">
      {orders.map((o) => {
        const b = BUCKET_TL[o.bucket] ?? { label: o.bucket, tone: "bg-slate-100 text-slate-700" };
        return (
          <li key={o.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold">{o.shopName}</p>
                <p className="text-xs text-slate-500">
                  {o.orderNumber} · {new Date(o.createdAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${b.tone}`}>{b.label}</span>
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-slate-700">{o.itemsSummary}</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">
                {peso(o.total)}
                {o.refunded > 0 && <span className="ml-2 text-xs font-medium text-slate-500">({peso(o.refunded)} na-refund)</span>}
              </p>
              <div className="flex gap-2">
                {o.orderPath && (
                  <Link href={o.orderPath} className="rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-slate-300 hover:bg-slate-50">
                    Tingnan
                  </Link>
                )}
                <Link href={o.checkoutLinkCode ? `/c/${o.checkoutLinkCode}` : `/${o.shopSlug}`} className="rounded-full bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white">
                  Order ulit
                </Link>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AddressesTab({ state }: { state: ReturnType<typeof useGumaId> }) {
  const [editing, setEditing] = useState<{ id: string | null; label: string; address: KartAddress; makeDefault: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!editing) return;
    if (!isAddressComplete(editing.address)) return setError("Kumpletuhin ang address.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/id/addresses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: editing.id, label: editing.label || null, address: editing.address, makeDefault: editing.makeDefault }),
    });
    const d = (await res.json()) as { ok: boolean; error?: string };
    setBusy(false);
    if (!d.ok) return setError(d.error ?? "Hindi ma-save.");
    setEditing(null);
    await state.refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/id/addresses?id=${id}`, { method: "DELETE" });
    await state.refresh();
  }

  return (
    <div className="space-y-3">
      {state.addresses.map((a) => (
        <div key={a.id} className="flex items-start justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="min-w-0 text-sm">
            <p className="font-semibold">
              {a.label || "Address"} {a.isDefault && <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800">Default</span>}
            </p>
            <p className="text-slate-600">{formatAddress(toKartAddress(a.address))}</p>
          </div>
          <div className="flex shrink-0 gap-2 text-sm">
            <button type="button" className="underline" onClick={() => setEditing({ id: a.id, label: a.label ?? "", address: toKartAddress(a.address), makeDefault: a.isDefault })}>
              Edit
            </button>
            <button type="button" aria-label="Delete address" className="text-slate-400 hover:text-red-600" onClick={() => void remove(a.id)}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
      {!editing ? (
        <button type="button" className="w-full rounded-2xl border-2 border-dashed border-slate-300 py-4 text-sm font-semibold text-slate-600" onClick={() => setEditing({ id: null, label: "", address: EMPTY_ADDRESS, makeDefault: state.addresses.length === 0 })}>
          + Magdagdag ng address
        </button>
      ) : (
        <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <input className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" placeholder="Label (Bahay, Opisina…)" value={editing.label} maxLength={40} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
          <AddressSelect value={editing.address} onChange={(address) => setEditing({ ...editing, address })} lang="tl" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editing.makeDefault} onChange={(e) => setEditing({ ...editing, makeDefault: e.target.checked })} /> Gawing default
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void save()}>
              {busy ? "Sine-save…" : "I-save"}
            </button>
            <button type="button" className="rounded-xl px-4 text-sm ring-1 ring-slate-300" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileTab({ state }: { state: ReturnType<typeof useGumaId> }) {
  const [name, setName] = useState(state.buyer?.name ?? "");
  const [email, setEmail] = useState(state.buyer?.email ?? "");
  const [pay, setPay] = useState(state.buyer?.preferredPayment ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [shops, setShops] = useState<ShopPref[] | null>(null);

  const loadShops = useCallback(async () => {
    const d = (await (await fetch("/api/id/orders", { cache: "no-store" })).json()) as { shops?: ShopPref[] };
    setShops(d.shops ?? []);
  }, []);
  useEffect(() => {
    void loadShops();
  }, [loadShops]);

  async function save() {
    const res = await fetch("/api/id/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, email: email || null, preferredPayment: pay || null }) });
    const d = (await res.json()) as { ok: boolean; error?: string };
    setMsg(d.ok ? "Na-save." : d.error ?? "Hindi ma-save.");
    if (d.ok) await state.refresh();
  }

  async function toggle(tenantId: string, on: boolean) {
    const res = await fetch("/api/id/reminders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, on }) });
    const d = (await res.json()) as { ok: boolean; shops?: ShopPref[] };
    if (d.ok && d.shops) setShops(d.shops);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <label className="block text-sm">
          <span className="mb-1 block font-semibold">Pangalan</span>
          <input className="h-11 w-full rounded-xl border border-slate-300 px-3" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold">Email (optional)</span>
          <input className="h-11 w-full rounded-xl border border-slate-300 px-3" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-semibold">Paboritong bayad</span>
          <select className="h-11 w-full rounded-xl border border-slate-300 px-3" value={pay} onChange={(e) => setPay(e.target.value)}>
            <option value="">Walang default</option>
            {Object.entries(PAY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <button type="button" className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white" onClick={() => void save()}>
          I-save
        </button>
        {msg && <p className="text-sm text-slate-600">{msg}</p>}
      </div>
      <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <p className="font-semibold">Reminder texts kada shop</p>
        <p className="text-xs text-slate-500">Ang order updates (bayad, padala) ay laging darating. Ito ay para sa reminders at promos.</p>
        {!shops ? (
          <Loader2 className="mt-3 h-4 w-4 animate-spin" />
        ) : shops.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Wala pang shop.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {shops.map((s) => (
              <li key={s.tenantId} className="flex items-center justify-between py-2.5 text-sm">
                <span>{s.shopName}</span>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={!s.remindersOff} onChange={(e) => void toggle(s.tenantId, e.target.checked)} aria-label={`Reminder texts from ${s.shopName}`} />
                  {s.remindersOff ? "Off" : "On"}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PrivacyTab() {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  async function signOut(everywhere: boolean) {
    await fetch(`/api/id/logout${everywhere ? "?everywhere=1" : ""}`, { method: "POST" });
    window.location.assign("/account");
  }
  async function del() {
    setBusy(true);
    await fetch("/api/id/me", { method: "DELETE" });
    window.location.assign("/account");
  }
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <p className="font-semibold">Ang hawak namin</p>
        <p className="mt-1 text-slate-600">Ang number mo, pangalan, email (kung nilagay), mga address, at listahan ng order mo. Ang bawat shop ay may sarili lang na kopya ng order na ginawa mo sa kanila.</p>
        <a href="/api/id/export" className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 font-semibold ring-1 ring-slate-300">
          <Download className="h-4 w-4" /> I-download ang data ko
        </a>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 font-semibold ring-1 ring-slate-300" onClick={() => void signOut(false)}>
          <LogOut className="h-4 w-4" /> Mag-sign out
        </button>
        <button type="button" className="rounded-xl px-4 py-2 font-semibold ring-1 ring-slate-300" onClick={() => void signOut(true)}>
          Sign out sa lahat ng device
        </button>
      </div>
      <div className="rounded-2xl bg-white p-4 ring-1 ring-red-200">
        <p className="font-semibold text-red-700">Burahin ang Guma ID</p>
        <p className="mt-1 text-slate-600">Mabubura ang account at mga address mo. Ang mga shop ay mananatili sa kanilang record ng order (kailangan nila ito), pero hindi na naka-link sa iyo.</p>
        <input className="mt-3 h-10 w-full rounded-xl border border-slate-300 px-3" placeholder='I-type ang "BURAHIN"' value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button type="button" disabled={confirm !== "BURAHIN" || busy} className="mt-2 rounded-xl bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-40" onClick={() => void del()}>
          Burahin
        </button>
      </div>
    </div>
  );
}
