import { Card } from "@gumakart/ui";
import { SukiShare } from "@/components/suki-share";

const LABEL: Record<string, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" };
const peso = (n: number) => `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

/** Phase 27: the buyer's Suki points at this shop, on the order page (only when the shop has it on). */
export function SukiOrderCard({
  data,
  slug,
}: {
  data: {
    shopName: string;
    earned: number;
    pending: number;
    balance: number;
    tier: string;
    next: { tier: string; needed: number } | null;
    creditValue: number;
    minRedeem: number;
    referral: { code: string; referrerReward: number; friendReward: number; minOrder: number } | null;
  };
  slug: string;
}) {
  return (
    <div data-testid="suki-card">
    <Card className="border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-violet-700">★ Suki {LABEL[data.tier] ?? data.tier}</p>
          <p className="mt-1 text-sm text-slate-700">
            {data.earned > 0
              ? `Nakakuha ka ng ${data.earned} Suki point${data.earned === 1 ? "" : "s"} sa order na ito.`
              : data.pending > 0
                ? `Makakakuha ka ng ${data.pending} Suki point${data.pending === 1 ? "" : "s"} kapag bayad na ang order.`
                : `Suki points mo sa ${data.shopName}.`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black text-violet-700">{data.balance}</p>
          <p className="text-[11px] text-slate-500">points</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-600">
        {data.balance >= data.minRedeem
          ? `Worth ${peso(data.creditValue)} store credit — message ${data.shopName} to use it on your next order.`
          : `Pwede nang gamitin pag ${data.minRedeem} points na.`}
        {data.next ? ` ${peso(data.next.needed)} pa para maging Suki ${LABEL[data.next.tier] ?? data.next.tier} (mas maraming points).` : ""}
      </p>
      {data.referral && <SukiShare slug={slug} shopName={data.shopName} referral={data.referral} />}
    </Card>
    </div>
  );
}
