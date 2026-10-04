"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Delete, Loader2, Lock } from "lucide-react";

interface StaffItem {
  id: string;
  name: string;
  role: "cashier" | "manager";
}

/** Cashier PIN screen. Only works on a device the owner set up as a register. */
export function PosLogin() {
  const router = useRouter();
  const [data, setData] = useState<{ device: boolean; shopName?: string; staff: StaffItem[] } | null>(null);
  const [picked, setPicked] = useState<StaffItem | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/pos/login", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData({ device: Boolean(d.device), shopName: d.shopName, staff: d.staff ?? [] }))
      .catch(() => setData({ device: false, staff: [] }));
  }, []);

  async function submit(fullPin: string) {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pos/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: picked.id, pin: fullPin }),
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.error ?? "Wrong PIN.");
        setPin("");
        setBusy(false);
        return;
      }
      router.replace("/pos");
    } catch {
      setError("No connection. Try again.");
      setBusy(false);
    }
  }

  function press(d: string) {
    if (busy) return;
    const next = (pin + d).slice(0, 6);
    setPin(next);
    setError(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!picked) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter" && pin.length >= 4) void submit(pin);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0A0F1D] p-4 text-slate-100">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600/25">
            <Lock className="h-6 w-6 text-violet-300" />
          </div>
          <h1 className="text-xl font-bold">{data?.shopName ? `${data.shopName} · POS` : "Register locked"}</h1>
        </div>

        {!data ? (
          <div className="flex justify-center text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !data.device ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-sm text-slate-300">
            <p>This device isn&apos;t set up as a register yet.</p>
            <p className="mt-2">
              The shop owner signs in once, opens <b>POS</b>, and taps <b>Use this device for cashiers</b>.
            </p>
            <Link href="/login?next=/pos" className="mt-4 inline-block rounded-xl bg-violet-600 px-4 py-2.5 font-semibold text-white">
              Owner sign-in
            </Link>
          </div>
        ) : data.staff.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-sm text-slate-300">
            No staff yet. The owner adds cashiers in Settings → POS &amp; staff.
            <Link href="/login?next=/settings/pos" className="mt-4 block font-semibold text-violet-300">
              Owner sign-in
            </Link>
          </div>
        ) : !picked ? (
          <>
            <p className="mb-3 text-center text-sm text-slate-400">Who&apos;s on the register?</p>
            <ul className="grid grid-cols-2 gap-2">
              {data.staff.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(s)}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-4 text-center hover:border-violet-400/60"
                    data-testid="pos-staff"
                  >
                    <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-violet-600/30 text-lg font-bold">
                      {s.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="block truncate font-semibold">{s.name}</span>
                    <span className="text-xs text-slate-400">{s.role === "manager" ? "Manager" : "Cashier"}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-center text-xs text-slate-500">
              Owner?{" "}
              <Link href="/login?next=/pos" className="text-violet-300">
                Sign in
              </Link>
            </p>
          </>
        ) : (
          <div className="text-center">
            <p className="text-sm text-slate-400">
              Hi {picked.name}! Enter your PIN.{" "}
              <button type="button" className="text-violet-300" onClick={() => { setPicked(null); setPin(""); setError(null); }}>
                Not you?
              </button>
            </p>
            <div className="my-5 flex justify-center gap-3" aria-label={`${pin.length} digits entered`}>
              {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                <span key={i} className={`h-3.5 w-3.5 rounded-full ${i < pin.length ? "bg-violet-400" : "bg-white/15"}`} />
              ))}
            </div>
            {error && <p className="mb-3 text-sm text-red-400" role="alert">{error}</p>}
            <div className="mx-auto grid max-w-[280px] grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} type="button" className="rounded-2xl bg-white/[0.06] py-4 text-xl font-semibold active:bg-white/15" onClick={() => press(d)} data-testid={`pin-${d}`}>
                  {d}
                </button>
              ))}
              <button type="button" className="rounded-2xl py-4 text-slate-400" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete">
                <Delete className="mx-auto h-5 w-5" />
              </button>
              <button type="button" className="rounded-2xl bg-white/[0.06] py-4 text-xl font-semibold active:bg-white/15" onClick={() => press("0")} data-testid="pin-0">
                0
              </button>
              <button
                type="button"
                className="rounded-2xl bg-violet-600 py-4 text-sm font-bold disabled:opacity-40"
                disabled={pin.length < 4 || busy}
                onClick={() => void submit(pin)}
                data-testid="pin-enter"
              >
                {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Enter"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
