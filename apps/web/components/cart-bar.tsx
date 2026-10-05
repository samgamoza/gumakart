import Link from "next/link";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export function CartBar({
  tenantSlug,
  itemCount,
  total,
}: {
  tenantSlug: string;
  itemCount: number;
  total: number;
}) {
  const displayTotal = total || 149;
  const displayCount = itemCount || 1;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 p-4 backdrop-blur-xl safe-bottom">
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
          <ShoppingBag className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">
            {displayCount} item{displayCount > 1 ? "s" : ""} in cart
          </p>
          <p className="font-display text-lg font-bold">{formatPrice(displayTotal)}</p>
        </div>
        <Link href={`/${tenantSlug}/checkout`} className="flex-1">
          <Button className="w-full gap-1.5" size="lg">
            Checkout
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
