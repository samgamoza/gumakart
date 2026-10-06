"use client";

import { shrinkImage } from "@gumakart/ui/shrink-image";
import { useRef, useState } from "react";
import Image from "next/image";
import { ShopAssistant } from "@/components/storefront/shop-assistant";
import type { StorefrontStoreSettings } from "@/lib/storefront-settings";

export function ManualPaymentPanel({
  tenantSlug,
  orderNumber,
  accessToken,
  paymentMethod,
  totalLabel,
  instructions,
  shopAssistant,
  shopName,
  alreadyPaid,
  lang = "en",
}: {
  tenantSlug: string;
  orderNumber: string;
  /** Order access token from the buyer's link; required by the payment APIs. */
  accessToken: string;
  paymentMethod: string;
  totalLabel: string;
  instructions: {
    accountName: string | null;
    accountNumber: string | null;
    bankName: string | null;
    note: string;
  };
  shopAssistant: StorefrontStoreSettings["shopAssistant"];
  shopName: string;
  alreadyPaid: boolean;
  /** "tl" for checkout-link buyers (their order form was Taglish). */
  lang?: "en" | "tl";
}) {
  const tx = (en: string, tl: string) => (lang === "tl" ? tl : en);
  const fileRef = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState("");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofName, setProofName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  if (alreadyPaid) return null;
  if (paymentMethod === "cod") return null;

  async function uploadScreenshot(original: File) {
    setUploading(true);
    setError(null);
    try {
      // Phase 20: smaller upload on mobile data; receipts stay readable at 2000 px.
      const file = await shrinkImage(original, { maxSide: 2000, quality: 0.85 });
      const formData = new FormData();
      formData.set("tenantSlug", tenantSlug);
      formData.set("orderNumber", orderNumber);
      formData.set("accessToken", accessToken);
      formData.set("file", file);
      const res = await fetch("/api/orders/payment-proof", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!data.ok || typeof data.url !== "string") {
        setError(data.error ?? tx("Could not upload screenshot.", "Hindi na-upload ang screenshot."));
        return;
      }
      setProofUrl(data.url);
      setProofName(file.name);
    } catch {
      setError(tx("Network error while uploading.", "Walang connection habang nag-a-upload."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submitReference() {
    if (reference.trim().length < 4 && !proofUrl) {
      setError(tx("Enter a reference number and/or upload a payment screenshot.", "Ilagay ang reference no. o i-upload ang screenshot ng bayad."));
      setStatus("error");
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/orders/payment-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          orderNumber,
          accessToken,
          reference: reference.trim() || `screenshot-${Date.now()}`,
          proofUrl: proofUrl ?? "",
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? tx("Could not save payment proof.", "Hindi na-save ang proof of payment."));
        setStatus("error");
        return;
      }
      setStatus("ok");
      setChatOpen(true);
    } catch {
      setError(tx("Network error.", "Walang connection. Subukan ulit."));
      setStatus("error");
    }
  }

  const methodLabel =
    paymentMethod === "paymaya" ? "Maya" : paymentMethod === "bank" ? "Bank" : "GCash";

  return (
    <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
      <div>
        <p className="text-sm font-semibold">{tx(`Pay via ${methodLabel} (direct transfer)`, `Magbayad via ${methodLabel}`)}</p>
        {lang === "tl" ? (
          <p className="mt-1 text-sm">
            Magpadala ng eksaktong <strong>{totalLabel}</strong> at ilagay ang <strong>{orderNumber}</strong> sa
            message/notes ng transfer.
          </p>
        ) : (
          <p className="mt-1 text-sm">
            Send exactly <strong>{totalLabel}</strong> and include{" "}
            <strong>{orderNumber}</strong> in the transfer notes.
          </p>
        )}
      </div>
      <dl className="space-y-1 text-sm">
        {instructions.bankName ? (
          <div>
            <dt className="inline text-amber-800/80">Bank: </dt>
            <dd className="inline font-medium">{instructions.bankName}</dd>
          </div>
        ) : null}
        {instructions.accountName ? (
          <div>
            <dt className="inline text-amber-800/80">{tx("Account name: ", "Pangalan: ")}</dt>
            <dd className="inline font-medium">{instructions.accountName}</dd>
          </div>
        ) : null}
        {instructions.accountNumber ? (
          <div>
            <dt className="inline text-amber-800/80">Number: </dt>
            <dd className="inline font-medium">{instructions.accountNumber}</dd>
          </div>
        ) : (
          <p className="text-sm text-amber-900/80">
            {tx(
              "The shop has not published a receiving number yet — message them in chat for payment details.",
              "Wala pang nilagay na number ang shop — i-message sila para sa payment details."
            )}
          </p>
        )}
      </dl>
      {lang !== "tl" && <p className="text-xs text-amber-900/80">{instructions.note}</p>}

      <div className="space-y-2 rounded-xl border border-amber-200/80 bg-white/70 p-3">
        <p className="text-sm font-medium">{tx("Payment screenshot", "Screenshot ng bayad")}</p>
        <p className="text-xs text-amber-900/70">
          {tx(
            `Upload your ${methodLabel} receipt so the seller can confirm faster (JPG/PNG, max 5 MB).`,
            `I-upload ang ${methodLabel} receipt para mas mabilis ma-confirm ng seller (JPG/PNG, hanggang 5 MB).`
          )}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadScreenshot(file);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium disabled:opacity-50"
          >
            {uploading
              ? tx("Uploading…", "Nag-a-upload…")
              : proofUrl
                ? tx("Replace screenshot", "Palitan ang screenshot")
                : tx("Upload screenshot", "I-upload ang screenshot")}
          </button>
          {proofName ? (
            <span className="truncate text-xs text-neutral-600">{proofName}</span>
          ) : null}
        </div>
        {proofUrl ? (
          <div className="relative mt-2 h-40 w-full overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
            <Image
              src={proofUrl}
              alt="Payment screenshot preview"
              fill
              className="object-contain"
              unoptimized
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder={tx(`${methodLabel} reference no. (optional if screenshot uploaded)`, `${methodLabel} reference no. (optional kung may screenshot)`)}
          className="h-10 w-full rounded-lg border border-amber-200 bg-white px-3 text-sm sm:flex-1"
        />
        <button
          type="button"
          onClick={() => void submitReference()}
          disabled={status === "saving" || uploading}
          className="h-10 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === "saving" ? tx("Saving…", "Sine-save…") : tx("I paid — submit proof", "Nagbayad na ako — ipadala")}
        </button>
      </div>
      {status === "ok" ? (
        <p className="text-sm text-emerald-800">
          {tx(
            "Proof saved. Message the seller in chat if you need faster confirmation.",
            "Na-save ang proof. I-message ang seller kung kailangan mo ng mabilis na confirm."
          )}
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="button"
        onClick={() => setChatOpen(true)}
        className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-900 underline underline-offset-2"
      >
        {tx("Message seller about this payment", "I-message ang seller tungkol sa bayad")}
      </button>

      {chatOpen ? (
        <ShopAssistant
          tenantSlug={tenantSlug}
          shopName={shopName}
          assistant={shopAssistant}
          orderNumber={orderNumber}
          defaultOpen
          initialMode="seller"
          hideLauncher
          onClose={() => setChatOpen(false)}
        />
      ) : null}
    </div>
  );
}
