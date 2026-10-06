"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { formatPrice } from "@/lib/store-data";
import { cn } from "@/lib/utils";
import { useTenantV0Cart } from "./tenant-cart-provider";
import { FreeDeliveryNudge } from "@/components/free-delivery-nudge";
import { resolveDelivery, type StorefrontStoreSettings } from "@/lib/storefront-settings";

export function TenantCheckoutDrawer({ storeSettings }: { storeSettings?: StorefrontStoreSettings }) {
  const { items, count, subtotal, isOpen, closeCart, setQty, remove, tenantSlug } =
    useTenantV0Cart();
  const [step, setStep] = useState<"cart" | "done">("cart");
  // Phase 17b: the shop's own delivery rules (estimate — the address can change it at checkout).
  const delivery = storeSettings && subtotal > 0 ? resolveDelivery(subtotal, storeSettings) : null;
  const shipping = delivery ? delivery.fee : 0;
  const total = subtotal + shipping;

  const handleClose = () => {
    closeCart();
    setTimeout(() => setStep("cart"), 250);
  };

  return (
    <>
      <div
        aria-hidden={!isOpen}
        onClick={handleClose}
        className={cn(
          "fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm transition-opacity",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <aside
        role="dialog"
        aria-label="Shopping cart"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-background shadow-2xl transition-transform duration-300",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-foreground">
            <ShoppingBag className="size-5" />
            {step === "cart" ? `Your cart (${count})` : "Order placed"}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </div>

        {step === "cart" && items.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-muted">
              <ShoppingBag className="size-7 text-muted-foreground" />
            </span>
            <p className="font-display text-lg font-semibold text-foreground">Your cart is empty</p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Start shopping
            </button>
          </div>
        )}

        {step === "cart" && items.length > 0 && (
          <div className="flex-1 space-y-3 overflow-y-auto p-5">
            {items.map((item) => (
              <div key={item.id} className="flex gap-3 rounded-2xl border border-border p-3">
                <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-muted">
                  <Image
                    src={item.image || "/placeholder.svg"}
                    alt={item.name}
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
                  <p className="font-display text-base font-bold text-primary">
                    {formatPrice(item.price)}
                  </p>
                  <div className="mt-auto flex items-center justify-between">
                    <div className="flex items-center gap-1 rounded-full border border-border">
                      <button
                        type="button"
                        onClick={() => setQty(item.id, item.qty - 1)}
                        className="flex size-7 items-center justify-center rounded-full hover:bg-muted"
                      >
                        <Minus className="size-3.5" />
                      </button>
                      <span className="w-6 text-center text-sm font-medium tabular-nums">
                        {item.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQty(item.id, item.qty + 1)}
                        className="flex size-7 items-center justify-center rounded-full hover:bg-muted"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(item.id)}
                      className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-accent/15 text-accent">
              <CheckCircle2 className="size-9" />
            </span>
            <p className="font-display text-xl font-bold text-foreground">Added to cart!</p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Continue shopping
            </button>
          </div>
        )}

        {step === "cart" && items.length > 0 && (
          <div className="border-t border-border p-5">
            <FreeDeliveryNudge subtotal={subtotal} freeAbove={delivery?.freeAbove} className="mb-3" />
            <div className="mb-3 space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="text-foreground">{formatPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Delivery (estimate)</span>
                <span className="text-foreground">
                  {shipping === 0 ? "Free" : formatPrice(shipping)}
                </span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-display text-base font-bold text-foreground">
                <span>Total</span>
                <span>{formatPrice(total)}</span>
              </div>
            </div>
            <Link
              href={`/${tenantSlug}/checkout`}
              onClick={handleClose}
              className="flex w-full items-center justify-center rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
            >
              Checkout · {formatPrice(total)}
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}
