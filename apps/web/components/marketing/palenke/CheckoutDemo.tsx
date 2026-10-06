"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Link2, MessageCircle, Package, Smartphone, Truck } from "lucide-react";

/**
 * Frontend3 (Palenke AI) — an animated walk-through of the real Guma Kart flow.
 * It is labelled as a demo and shows steps, not invented numbers.
 */
const STEPS = [
  { icon: MessageCircle, title: "Buyer comments “mine!” on your post", detail: "You reply with your Guma Kart checkout link — no PM back-and-forth." },
  { icon: Link2, title: "Buyer opens the link in Messenger", detail: "Taglish one-page checkout. No app, no account." },
  { icon: CreditCard, title: "Pays with GCash, Maya or COD", detail: "GCash/Maya screenshot attached as proof; you confirm in one tap." },
  { icon: Package, title: "Order lands in your dashboard", detail: "Stock is reserved per variant, so you never oversell." },
  { icon: Truck, title: "Book the rider or schedule pickup", detail: "Delivery quote at checkout; booking from the order." },
] as const;

export function CheckoutDemo() {
  const [step, setStep] = useState(-1);
  const running = step >= 0 && step < STEPS.length;

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setStep((s) => s + 1), 1400);
    return () => clearTimeout(t);
  }, [running, step]);

  return (
    <div className="relative rounded-3xl border border-slate-800 bg-slate-900/60 p-6 shadow-2xl backdrop-blur-md" data-testid="palenke-demo">
      <div className="absolute -right-3 -top-3 rounded-full bg-indigo-600 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-md">
        Demo ⚡
      </div>
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-purple-400" />
          <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">Chat to checkout</span>
        </div>
        <span className={`h-2 w-2 rounded-full ${running ? "animate-ping bg-emerald-500" : "bg-slate-600"}`} />
      </div>

      {step < 0 ? (
        <div className="space-y-3 py-10 text-center">
          <p className="text-xs text-slate-400">See how an order moves from a comment to a booked rider.</p>
          <button
            type="button"
            onClick={() => setStep(0)}
            className="rounded-xl bg-purple-600 px-5 py-2.5 text-[11px] font-extrabold uppercase tracking-widest text-white shadow-md transition hover:bg-purple-700"
          >
            Play the demo
          </button>
        </div>
      ) : (
        <ol className="mt-4 space-y-2.5" aria-live="polite">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < step;
            const active = i === step;
            return (
              <li
                key={s.title}
                className={`flex items-start gap-3 rounded-xl border p-3 transition-all duration-500 ${
                  done
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : active
                      ? "border-purple-400/40 bg-purple-500/15"
                      : "border-slate-800 bg-slate-950/40 opacity-40"
                }`}
              >
                {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-purple-300" : "text-slate-500"}`} />}
                <div>
                  <p className="text-xs font-bold text-white">{s.title}</p>
                  {(done || active) && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{s.detail}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <span>GCash · Maya · COD</span>
        {step >= STEPS.length ? (
          <button type="button" onClick={() => setStep(0)} className="text-purple-300 hover:text-purple-200">
            Replay
          </button>
        ) : (
          <span>Illustration</span>
        )}
      </div>
    </div>
  );
}
