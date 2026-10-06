"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, ShoppingBag, X } from "lucide-react";

const PREF = "guma-order-alerts:v1";
const POLL_MS = 30_000;

/** Two short tones (WebAudio, no sound file). Browsers allow it after the seller has tapped the page once. */
function chime(ctxRef: React.MutableRefObject<AudioContext | null>) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctxRef.current ??= new Ctx();
    const ctx = ctxRef.current;
    void ctx.resume();
    [880, 1320].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.18);
    });
  } catch {
    /* no sound — the toast still shows */
  }
}

/**
 * Harvest H3 (palenkeAi's notification sound): while the dashboard is open, a chime + toast for each new
 * online order, and a desktop notification when the tab is in the background (if the seller allows it).
 * Polls every 30 s while visible. Off switch is remembered on this device only.
 */
export function NewOrderAlerts() {
  const [on, setOn] = useState(true);
  const [toast, setToast] = useState<{ orderNumber: string; total: number; count: number } | null>(null);
  const [disabled, setDisabled] = useState(false);
  const since = useRef(new Date().toISOString());
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    try {
      setOn(localStorage.getItem(PREF) !== "off");
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    if (!on || disabled) return;
    let stopped = false;
    async function poll() {
      if (stopped || document.visibilityState === "hidden" && !("Notification" in window && Notification.permission === "granted")) return;
      try {
        const r = await fetch(`/api/orders/latest?since=${encodeURIComponent(since.current)}`, { cache: "no-store" });
        if (r.status === 401 || r.status === 403) {
          setDisabled(true);
          return;
        }
        const d = await r.json();
        if (!d.ok) return;
        if (d.count > 0 && d.latest) {
          since.current = d.latest.createdAt;
          const peso = `₱${Number(d.latest.total).toLocaleString("en-PH")}`;
          setToast({ orderNumber: d.latest.orderNumber, total: d.latest.total, count: d.count });
          chime(audio);
          if (document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted") {
            new Notification(d.count > 1 ? `${d.count} new orders` : "New order", { body: `${d.latest.orderNumber} · ${peso}`, tag: "guma-new-order" });
          }
        }
      } catch {
        /* offline — try again next tick */
      }
    }
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [on, disabled]);

  function toggle() {
    const next = !on;
    setOn(next);
    try {
      localStorage.setItem(PREF, next ? "on" : "off");
    } catch {
      /* ignore */
    }
    if (next) {
      chime(audio); // unlocks audio with this tap and lets the seller hear it
      if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    }
  }

  if (disabled) return null;
  return (
    <>
      <button
        type="button"
        onClick={toggle}
        title={on ? "New-order alerts on (tap to mute)" : "New-order alerts off"}
        aria-label={on ? "Mute new-order alerts" : "Turn on new-order alerts"}
        className="fixed bottom-20 right-5 z-40 hidden h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#0d1224]/90 text-slate-300 shadow-lg hover:text-white md:flex"
        data-testid="order-alerts-toggle"
      >
        {on ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
      </button>
      {toast && (
        <div role="status" className="fixed left-1/2 top-4 z-50 flex w-[min(92vw,380px)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-emerald-400/30 bg-[#0d1a17] px-4 py-3 shadow-2xl" data-testid="new-order-toast">
          <ShoppingBag className="h-5 w-5 flex-none text-emerald-300" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white">{toast.count > 1 ? `${toast.count} new orders` : "New order!"}</p>
            <p className="truncate text-xs text-slate-300">
              {toast.orderNumber} · ₱{toast.total.toLocaleString("en-PH")}
            </p>
          </div>
          <Link href="/orders" onClick={() => setToast(null)} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-emerald-950">
            View
          </Link>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}
