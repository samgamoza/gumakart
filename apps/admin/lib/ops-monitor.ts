import {
  alertConditions,
  getOpsSnapshot,
  markAlertsNotified,
  pruneCronRuns,
  recordCronRuns,
  syncOpsAlerts,
  type CronRunInput,
  type OpsAlertRow,
} from "@gumakart/db";
import { helpdeskNotifyEmail, sendTransactionalEmail } from "@gumakart/services";
import { cronExpectations } from "@/lib/cron-schedule";

/** Where ops alerts go: OPS_ALERT_EMAIL, else the helpdesk inbox. Ready to hook up (Resend). */
export function opsAlertEmail(): string | null {
  return process.env.OPS_ALERT_EMAIL?.trim() || helpdeskNotifyEmail();
}

async function notify(opened: OpsAlertRow[], resolved: OpsAlertRow[]): Promise<boolean> {
  const to = opsAlertEmail();
  if (!to || (opened.length === 0 && resolved.length === 0)) return false;
  const critical = opened.some((a) => a.severity === "critical");
  const subject = opened.length
    ? `${critical ? "[CRITICAL] " : ""}Guma Kart: ${opened[0]!.title}${opened.length > 1 ? ` (+${opened.length - 1} more)` : ""}`
    : `Guma Kart: resolved — ${resolved[0]!.title}${resolved.length > 1 ? ` (+${resolved.length - 1} more)` : ""}`;
  const lines = [
    ...opened.map((a) => `OPEN  [${a.severity}] ${a.title}${a.detail ? `\n      ${a.detail}` : ""}`),
    ...resolved.map((a) => `FIXED ${a.title}`),
    "",
    "System health: https://ops.guma.one/system",
  ];
  const result = await sendTransactionalEmail({ to, subject, text: lines.join("\n"), tags: [{ name: "kind", value: "ops_alert" }] });
  return result.sent;
}

/** Called once per cron tick by the cron worker (and by hand in dev): record runs, check rules. */
export async function reportAndMonitor(runs: CronRunInput[], now = new Date()) {
  const recorded = await recordCronRuns(runs);
  const snapshot = await getOpsSnapshot(now);
  const { opened, resolved, open } = await syncOpsAlerts(alertConditions(snapshot, cronExpectations(), now), now);
  if (await notify(opened, resolved)) await markAlertsNotified(opened.map((a) => a.id), now);
  const pruned = now.getUTCMinutes() === 0 ? await pruneCronRuns(now) : 0;
  return { recorded, opened: opened.length, resolved: resolved.length, open: open.length, pruned };
}
