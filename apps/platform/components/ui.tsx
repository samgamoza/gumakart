import type { ReactNode } from "react";

// ─── Card ────────────────────────────────────────────────────────────────────

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h2 className="font-display text-base font-bold tracking-tight">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "emerald",
}: {
  label: string;
  value: string | number;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: "emerald" | "sky" | "amber" | "violet" | "rose";
}) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-500/10 text-emerald-600",
    sky: "bg-sky-500/10 text-sky-600",
    amber: "bg-amber-500/10 text-amber-600",
    violet: "bg-violet-500/10 text-violet-600",
    rose: "bg-rose-500/10 text-rose-600",
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight">{value}</p>
          {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
        </div>
        {icon && (
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}
          >
            {icon}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Status + plan pills ─────────────────────────────────────────────────────

const STATUS_TONES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  live: "bg-emerald-100 text-emerald-700",
  paid: "bg-emerald-100 text-emerald-700",
  approved: "bg-emerald-100 text-emerald-700",
  delivered: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  pending_payment: "bg-amber-100 text-amber-700",
  draft: "bg-slate-100 text-slate-600",
  scheduled: "bg-sky-100 text-sky-700",
  posted: "bg-emerald-100 text-emerald-700",
  suspended: "bg-rose-100 text-rose-700",
  cancelled: "bg-rose-100 text-rose-700",
  refunded: "bg-rose-100 text-rose-700",
  skipped: "bg-slate-100 text-slate-500",
  // message_log
  sent: "bg-emerald-100 text-emerald-700",
  queued: "bg-slate-100 text-slate-600",
  suppressed: "bg-slate-100 text-slate-500",
  // Phase 2 order states
  open: "bg-sky-100 text-sky-700",
  completed: "bg-emerald-100 text-emerald-700",
  unpaid: "bg-amber-100 text-amber-700",
  pending_verification: "bg-amber-100 text-amber-700",
  cod_due: "bg-sky-100 text-sky-700",
  failed: "bg-rose-100 text-rose-700",
  unfulfilled: "bg-slate-100 text-slate-600",
  ready: "bg-sky-100 text-sky-700",
  booked: "bg-sky-100 text-sky-700",
  picked_up: "bg-sky-100 text-sky-700",
  out_for_delivery: "bg-sky-100 text-sky-700",
  failed_delivery: "bg-rose-100 text-rose-700",
  returned: "bg-rose-100 text-rose-700",
};

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? "bg-slate-100 text-slate-600";
  const label = status.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${tone}`}
    >
      {status === "active" && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
      )}
      {label}
    </span>
  );
}

export function PlanBadge({ plan }: { plan: string }) {
  const tones: Record<string, string> = {
    free: "border-slate-200 bg-slate-50 text-slate-600",
    starter: "border-sky-200 bg-sky-50 text-sky-700",
    growth: "border-violet-200 bg-violet-50 text-violet-700",
    pro: "border-amber-200 bg-amber-50 text-amber-700",
  };
  const tone = tones[plan] ?? tones.free;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${tone}`}
    >
      {plan}
    </span>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-muted/30 py-14 text-center">
      {icon && (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          {icon}
        </span>
      )}
      <p className="font-semibold">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── SVG mini charts (no dependencies) ───────────────────────────────────────

export function AreaChart({
  points,
  height = 64,
  className = "",
  stroke = "hsl(160 84% 32%)",
  fill = "hsl(160 84% 32% / 0.12)",
}: {
  points: number[];
  height?: number;
  className?: string;
  stroke?: string;
  fill?: string;
}) {
  const width = 100;
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((p, i) => [i * step, height - (p / max) * (height - 8) - 4]);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      style={{ height }}
    >
      <path d={area} fill={fill} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function BarMeter({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((seg) => (
          <div
            key={seg.label}
            style={{ width: `${(seg.value / total) * 100}%`, backgroundColor: seg.color }}
            title={`${seg.label}: ${seg.value}`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((seg) => (
          <span key={seg.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seg.color }} />
            <span className="capitalize">{seg.label}</span>
            <span className="font-semibold text-foreground">{seg.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
