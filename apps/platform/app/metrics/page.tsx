import Link from "next/link";
import { getPlatformMetrics } from "@gumakart/db";
import { requireSuperAdmin } from "@/lib/session";
import { PlatformShell } from "@/components/platform-shell";
import { BarMeter, Panel, SectionHeader, StatCard } from "@/components/ui";
import { formatMoney, formatNumber } from "@/lib/format";

interface PageProps {
  searchParams: Promise<{ days?: string }>;
}

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
const hours = (h: number | null) => (h == null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);
const CHANNEL_LABEL: Record<string, string> = { checkout_link: "Checkout links", storefront: "Online store", pos: "POS" };
const CHANNEL_COLOR: Record<string, string> = { checkout_link: "#8b5cf6", storefront: "#0ea5e9", pos: "#10b981" };

/**
 * Plan §14 — is V1 working? Activation, conversion, fulfilment, messaging,
 * retention, POS. Pick a window; everything is computed live from the tables.
 */
export default async function MetricsPage({ searchParams }: PageProps) {
  const session = await requireSuperAdmin();
  const { days: daysParam } = await searchParams;
  const days = [7, 30, 90].includes(Number(daysParam)) ? Number(daysParam) : 7;
  const m = await getPlatformMetrics({ days });
  const maxWeek = Math.max(1, ...m.weekly.map((w) => w.checkoutLink + w.store + w.pos));

  return (
    <PlatformShell
      title="Metrics"
      subtitle={`Last ${days} days · plan §14 numbers`}
      user={{ displayName: session.displayName, email: session.email }}
    >
      <div className="space-y-6">
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`/metrics?days=${d}`}
              className={`rounded-full border px-3 py-1 text-sm ${d === days ? "border-foreground bg-foreground text-background" : "border-border"}`}
            >
              {d} days
            </Link>
          ))}
        </div>

        <Panel>
          <SectionHeader title="Activation" description="Shops created in this window and how far they got" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="New shops" value={formatNumber(m.activation.newShops)} />
            <StatCard label="Added a product" value={pct(m.activation.withProduct, m.activation.newShops)} sub={`${m.activation.withProduct} shops`} />
            <StatCard label="Made a checkout link" value={pct(m.activation.withLink, m.activation.newShops)} sub={`${m.activation.withLink} shops`} />
            <StatCard label="Got an order" value={pct(m.activation.withOrder, m.activation.newShops)} sub={`${m.activation.withOrder} shops`} />
            <StatCard label="Median time to 1st order" value={hours(m.activation.medianHoursToFirstOrder)} />
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="Conversion" description="Checkout links and payments" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Link views" value={formatNumber(m.conversion.linkViews)} sub="links made in window" />
            <StatCard label="Checkout starts" value={formatNumber(m.conversion.checkoutStarts)} sub={`${pct(m.conversion.checkoutStarts, m.conversion.linkViews)} of views`} />
            <StatCard label="Link orders" value={formatNumber(m.conversion.linkOrders)} sub={`${pct(m.conversion.linkOrders, m.conversion.linkViews)} of views`} />
            <StatCard label="Median payment confirm" value={m.conversion.medianMinutesToConfirmPayment == null ? "—" : hours(m.conversion.medianMinutesToConfirmPayment / 60)} sub="GCash/Maya/online" />
            <StatCard label="Recovered checkouts" value={formatNumber(m.conversion.recoveredOrders)} sub={`${m.conversion.recoveryTexts} reminder texts`} />
          </div>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel>
            <SectionHeader title="Fulfilment" description="Delivery orders (not POS)" />
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard label="Booked in Guma" value={pct(m.fulfillment.bookedInApp, m.fulfillment.deliveryOrders)} sub={`${m.fulfillment.bookedInApp} of ${m.fulfillment.deliveryOrders}`} />
              <StatCard
                label="Delivery success"
                value={pct(m.fulfillment.delivered, m.fulfillment.delivered + m.fulfillment.failedOrReturned)}
                sub={`${m.fulfillment.failedOrReturned} failed/returned`}
              />
              <StatCard label="Paid → delivered" value={hours(m.fulfillment.medianHoursPaidToDelivered)} sub="median" />
            </div>
          </Panel>
          <Panel>
            <SectionHeader title="Messaging" description="SMS in this window" />
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard label="Sent" value={formatNumber(m.messaging.sent)} />
              <StatCard label="Failed" value={formatNumber(m.messaging.failed)} tone="rose" sub={pct(m.messaging.failed, m.messaging.sent + m.messaging.failed)} />
              <StatCard label="Suppressed (opted out)" value={formatNumber(m.messaging.suppressed)} />
              <StatCard label="New opt-outs" value={formatNumber(m.messaging.optOuts)} />
            </div>
          </Panel>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel>
            <SectionHeader title="Retention" />
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard label="Shops with an order · 7 days" value={formatNumber(m.retention.activeShops7d)} />
              <StatCard label="Shops with an order · 30 days" value={formatNumber(m.retention.activeShops30d)} />
              <StatCard label="Buyers" value={formatNumber(m.retention.buyers)} />
              <StatCard label="Repeat buyers" value={pct(m.retention.repeatBuyers, m.retention.buyers)} sub={`${m.retention.repeatBuyers} ordered 2+ times`} />
              <StatCard label="Orders with Guma ID" value={pct(m.gumaId.withGumaId, m.gumaId.orders)} sub={`${m.gumaId.withGumaId} of ${m.gumaId.orders} online orders`} />
              <StatCard label="Guma ID accounts" value={formatNumber(m.gumaId.accounts)} />
            </div>
          </Panel>
          <Panel>
            <SectionHeader title="Sales by channel" />
            <BarMeter
              segments={m.byChannel.map((c) => ({
                label: CHANNEL_LABEL[c.channel] ?? c.channel,
                value: c.orders,
                color: CHANNEL_COLOR[c.channel] ?? "#94a3b8",
              }))}
            />
            <ul className="mt-4 space-y-1 text-sm">
              {m.byChannel.map((c) => (
                <li key={c.channel} className="flex justify-between">
                  <span>{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                  <span className="font-semibold">
                    {formatNumber(c.orders)} · {formatMoney(c.sales)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <Panel>
          <SectionHeader title="Orders per week" description="Last 8 weeks, excluding cancelled" />
          {m.weekly.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <div className="flex h-40 items-end gap-3">
              {m.weekly.map((w) => {
                const total = w.checkoutLink + w.store + w.pos;
                return (
                  <div key={w.week} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-xs font-semibold">{total}</span>
                    <div className="flex w-full max-w-12 flex-col-reverse overflow-hidden rounded-md" style={{ height: `${(total / maxWeek) * 110}px` }}>
                      <div style={{ flex: w.checkoutLink, background: CHANNEL_COLOR.checkout_link }} title={`Links ${w.checkoutLink}`} />
                      <div style={{ flex: w.store, background: CHANNEL_COLOR.storefront }} title={`Store ${w.store}`} />
                      <div style={{ flex: w.pos, background: CHANNEL_COLOR.pos }} title={`POS ${w.pos}`} />
                    </div>
                    <span className="text-[11px] text-muted-foreground">{w.week.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </PlatformShell>
  );
}
