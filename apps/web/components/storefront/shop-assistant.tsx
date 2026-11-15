"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import type { StorefrontStoreSettings } from "@/lib/storefront-settings";

type ChatMessage = {
  id: string;
  role: "buyer" | "assistant" | "seller" | "user";
  content: string;
};

function sessionKey(tenantSlug: string): string {
  return `guma-chat-${tenantSlug}`;
}

/**
 * MVP Beta shop chat: owner-led by default (Message seller).
 * AI FAQ is optional via "Quick answers" when assistant.enabled.
 */
export function ShopAssistant({
  tenantSlug,
  shopName,
  assistant,
  orderNumber,
  defaultOpen,
  initialMode,
  whatsappUrl,
  hideLauncher,
  onClose,
}: {
  tenantSlug: string;
  shopName: string;
  assistant: StorefrontStoreSettings["shopAssistant"];
  orderNumber?: string;
  defaultOpen?: boolean;
  /** Prefer seller for payment/order; auto only when AI FAQ is enabled. */
  initialMode?: "auto" | "seller";
  whatsappUrl?: string | null;
  /** Hide the floating bubble (use with an external CTA). */
  hideLauncher?: boolean;
  onClose?: () => void;
}) {
  const humanOnly = assistant.humanInbox !== false;
  const aiEnabled = Boolean(assistant.enabled);
  const chatAvailable = humanOnly || aiEnabled;

  const defaultMode: "auto" | "seller" =
    initialMode ?? (aiEnabled && !orderNumber ? "auto" : "seller");

  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [sessionId, setSessionId] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"auto" | "seller">(defaultMode);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(
    async (sid: string) => {
      try {
        const res = await fetch(
          `/api/chat?tenantSlug=${encodeURIComponent(tenantSlug)}&sessionId=${encodeURIComponent(sid)}`
        );
        const data = await res.json();
        if (!data.ok || !Array.isArray(data.messages) || data.messages.length === 0) return;
        setMessages(
          data.messages.map((m: { id: string; role: string; content: string }) => ({
            id: m.id,
            role: m.role as ChatMessage["role"],
            content: m.content,
          }))
        );
      } catch {
        // keep greeting
      }
    },
    [tenantSlug]
  );

  useEffect(() => {
    const stored = localStorage.getItem(sessionKey(tenantSlug));
    const id = stored ?? crypto.randomUUID();
    localStorage.setItem(sessionKey(tenantSlug), id);
    setSessionId(id);
    setMessages([
      {
        id: "greeting",
        role: "assistant",
        content: orderNumber
          ? `Hi! Message ${shopName} about order ${orderNumber} — payment proof, changes, or questions. They reply in this chat.`
          : assistant.greeting.replace("{shop}", shopName),
      },
    ]);
    void loadHistory(id);
  }, [tenantSlug, shopName, assistant.greeting, loadHistory, orderNumber]);

  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (!open || !sessionId) return;
    const timer = window.setInterval(() => {
      void loadHistory(sessionId);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [open, sessionId, loadHistory]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  function closeChat() {
    setOpen(false);
    onClose?.();
  }

  if (!chatAvailable) return null;

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading || !sessionId) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "buyer",
      content: text,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          sessionId,
          message: text,
          mode: aiEnabled ? mode : "seller",
          orderNumber,
        }),
      });
      const data = await res.json();
      const reply =
        typeof data.reply === "string"
          ? data.reply
          : "Message saved. The seller can reply here — try again if nothing appears.";

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: reply },
      ]);
      await loadHistory(sessionId);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {!hideLauncher ? (
        <button
          type="button"
          onClick={() => {
            setMode(orderNumber ? "seller" : defaultMode);
            setOpen(true);
          }}
          className="fixed bottom-24 left-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg transition hover:scale-105 md:bottom-8"
          aria-label={`Message ${shopName}`}
        >
          <MessageCircle className="h-7 w-7" />
        </button>
      ) : null}

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-end p-4 md:items-end md:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close chat"
            onClick={closeChat}
          />
          <div className="relative flex h-[min(560px,85vh)] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <div>
                <p className="font-semibold text-neutral-900">
                  {mode === "seller" ? "Message seller" : assistant.name}
                </p>
                <p className="text-xs text-neutral-500">
                  {shopName}
                  {orderNumber ? ` · Order ${orderNumber}` : " · products, payment & revisions"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeChat}
                className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-2">
              <button
                type="button"
                onClick={() => setMode("seller")}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  mode === "seller"
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-600"
                }`}
              >
                Message seller
              </button>
              {aiEnabled ? (
                <button
                  type="button"
                  onClick={() => setMode("auto")}
                  className={`rounded-full px-3 py-1 text-xs ${
                    mode === "auto"
                      ? "bg-neutral-900 text-white"
                      : "bg-neutral-100 text-neutral-600"
                  }`}
                >
                  Quick answers
                </button>
              ) : null}
              {whatsappUrl ? (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto rounded-full bg-[#25D366]/15 px-3 py-1 text-xs font-medium text-[#128C7E] hover:bg-[#25D366]/25"
                >
                  WhatsApp
                </a>
              ) : null}
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.map((message) => {
                const fromBuyer = message.role === "buyer" || message.role === "user";
                const fromSeller = message.role === "seller";
                return (
                  <div
                    key={message.id}
                    className={`flex ${fromBuyer ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        fromBuyer
                          ? "bg-neutral-900 text-white"
                          : fromSeller
                            ? "bg-emerald-50 text-emerald-950 ring-1 ring-emerald-100"
                            : "bg-neutral-100 text-neutral-800"
                      }`}
                    >
                      {fromSeller ? (
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          Seller
                        </p>
                      ) : null}
                      <LinkedText text={message.content} />
                    </div>
                  </div>
                );
              })}
              {loading && (
                <p className="text-xs text-neutral-400">
                  {mode === "seller" ? "Sending to seller…" : "Looking up a quick answer…"}
                </p>
              )}
            </div>

            <form
              className="border-t border-neutral-100 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
            >
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    mode === "seller"
                      ? "Payment ref, change request, question…"
                      : "Hours, delivery area, how to pay…"
                  }
                  className="h-11 flex-1 rounded-xl border border-neutral-200 px-3 text-sm outline-none focus:border-neutral-400"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-900 text-white disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/** Message text with http(s) links made tappable (the assistant sends checkout links). */
function LinkedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part.replace(/[.,!?)]+$/, "")} className="font-semibold underline underline-offset-2">
            {part}
          </a>
        ) : (
          part
        )
      )}
    </span>
  );
}
