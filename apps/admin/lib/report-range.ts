/**
 * Phase 14: report date ranges in Manila time. `from`/`to` are YYYY-MM-DD (inclusive days);
 * or `preset` = today | 7d | 30d | 90d | month | lastmonth | year. Max 366 days.
 */
const DAY = 86_400_000;
const OFFSET = 8 * 3_600_000;

function manilaMidnight(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t - OFFSET) : null;
}

function todayManila(now: Date): string {
  return new Date(now.getTime() + OFFSET).toISOString().slice(0, 10);
}

export function parseReportRange(params: URLSearchParams, now = new Date()): { from: Date; to: Date; label: string } {
  const preset = params.get("preset") ?? "";
  const today = manilaMidnight(todayManila(now))!;
  const tomorrow = new Date(today.getTime() + DAY);
  const from = params.get("from");
  const to = params.get("to");
  if (from && to) {
    const f = manilaMidnight(from);
    const t = manilaMidnight(to);
    if (f && t && t >= f) {
      const end = new Date(Math.min(t.getTime() + DAY, f.getTime() + 366 * DAY));
      return { from: f, to: end, label: `${from} – ${to}` };
    }
  }
  const local = new Date(now.getTime() + OFFSET);
  switch (preset) {
    case "today":
      return { from: today, to: tomorrow, label: "Today" };
    case "7d":
      return { from: new Date(tomorrow.getTime() - 7 * DAY), to: tomorrow, label: "Last 7 days" };
    case "90d":
      return { from: new Date(tomorrow.getTime() - 90 * DAY), to: tomorrow, label: "Last 90 days" };
    case "month": {
      const f = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - OFFSET);
      return { from: f, to: tomorrow, label: "This month" };
    }
    case "lastmonth": {
      const f = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1) - OFFSET);
      const t = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - OFFSET);
      return { from: f, to: t, label: "Last month" };
    }
    case "year": {
      const f = new Date(Date.UTC(local.getUTCFullYear(), 0, 1) - OFFSET);
      return { from: f, to: tomorrow, label: "This year" };
    }
    default:
      return { from: new Date(tomorrow.getTime() - 30 * DAY), to: tomorrow, label: "Last 30 days" };
  }
}
