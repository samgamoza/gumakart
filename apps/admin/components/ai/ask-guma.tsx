"use client";

import { useState } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";

interface Answer {
  question: string;
  answer: string;
  actions: string[];
  facts?: { periodDays: number; sales: number; orders: number };
}

const SUGGESTED = [
  "Kumusta ang benta ko ngayong buwan?",
  "Ano ang dapat kong i-restock?",
  "Paano ko mapapataas ang benta sa susunod na payday?",
];

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;

/**
 * Phase 26: "Ask Guma" — a floating business advisor (the palenkeAi idea) that answers only from
 * the shop's own last-30-day numbers. The numbers it used are shown under each answer.
 */
export function AskGuma() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/advisor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (res.status === 403) {
        setHidden(true);
        return;
      }
      const d = await res.json();
      if (!d.ok) return setError(d.error ?? "Couldn't answer just now.");
      setAnswers((a) => [{ question: q, answer: d.answer, actions: d.actions ?? [], facts: d.facts }, ...a].slice(0, 5));
      setQuestion("");
    } catch {
      setError("No connection. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (hidden) return null;
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-xl shadow-violet-900/40 hover:-translate-y-0.5"
          data-testid="ask-guma-open"
        >
          <Sparkles className="h-4 w-4" /> Ask Guma
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Ask Guma"
          className="fixed inset-x-3 bottom-3 z-50 flex max-h-[80vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d1224] shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[400px]"
          data-testid="ask-guma"
        >
          <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-violet-600/30 to-indigo-600/20 px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-300" />
              <div>
                <p className="text-sm font-bold text-white">Ask Guma</p>
                <p className="text-[11px] text-slate-400">Uses only your shop's last 30 days</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {answers.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">Try asking:</p>
                {SUGGESTED.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void ask(s)}
                    disabled={busy}
                    className="block w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/[0.07]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {busy && (
              <p className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Tinitingnan ang numbers mo…
              </p>
            )}
            {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
            {answers.map((a, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid="ask-guma-answer">
                <p className="text-xs font-semibold text-violet-200">{a.question}</p>
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-100">{a.answer}</p>
                {a.actions.length > 0 && (
                  <ul className="space-y-1">
                    {a.actions.map((x) => (
                      <li key={x} className="flex gap-2 text-xs text-slate-300">
                        <span className="text-violet-300">→</span> {x}
                      </li>
                    ))}
                  </ul>
                )}
                {a.facts && (
                  <p className="text-[11px] text-slate-500">
                    Based on {a.facts.periodDays} days: {peso(a.facts.sales)} · {a.facts.orders} orders
                  </p>
                )}
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
            className="flex items-center gap-2 border-t border-white/10 p-3"
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about your sales, stock, promos…"
              maxLength={500}
              className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400"
            />
            <button type="submit" disabled={busy || question.trim().length < 3} aria-label="Ask" className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
