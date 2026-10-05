/** Phase 16 — pure rules: alerts, error grouping, plan states, status mapping (no DB). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alertConditions, normalizeErrorMessage, type OpsSnapshot } from "./queries/operations";
import { dueNoticeKind, planStatusOf, PLAN_GRACE_DAYS } from "./queries/billing";
import { componentForAlert, incidentState } from "./queries/status-page";

const now = new Date("2026-10-06T04:00:00Z");
const base: OpsSnapshot = {
  outbox: { pending: 0, stuck: 0, oldestPendingMinutes: 0 },
  webhooks: { unfanned: 0, oldestUnfannedMinutes: 0, pendingDeliveries: 0 },
  sms: { sent1h: 0, failed1h: 0 },
  errors: { last15m: 0, open: 0 },
  cron: [],
};
const job = (over: Partial<OpsSnapshot["cron"][number]>) => ({
  job: "/api/cron/outbox",
  lastRunAt: new Date(now.getTime() - 60_000),
  lastOk: true,
  lastSummary: "published=3",
  lastDurationMs: 120,
  lastSuccessAt: new Date(now.getTime() - 60_000),
  runs24h: 1440,
  failures24h: 0,
  avgMs24h: 100,
  ...over,
});

describe("alert rules", () => {
  it("quiet when everything is fine", () => {
    assert.deepEqual(alertConditions({ ...base, cron: [job({})] }, { "/api/cron/outbox": 10 }, now), []);
  });
  it("outbox stuck and backlog", () => {
    const keys = alertConditions({ ...base, outbox: { pending: 40, stuck: 2, oldestPendingMinutes: 20 } }, {}, now).map((c) => `${c.key}:${c.severity}`);
    assert.deepEqual(keys, ["outbox_stuck:critical", "outbox_backlog:warning"]);
  });
  it("SMS failure rate needs at least 10 sends and >25% failed", () => {
    assert.equal(alertConditions({ ...base, sms: { sent1h: 2, failed1h: 3 } }, {}, now).length, 0);
    assert.equal(alertConditions({ ...base, sms: { sent1h: 10, failed1h: 4 } }, {}, now)[0]?.key, "sms_failures");
    assert.equal(alertConditions({ ...base, sms: { sent1h: 30, failed1h: 5 } }, {}, now).length, 0);
  });
  it("errors: warning, critical at 5+", () => {
    assert.equal(alertConditions({ ...base, errors: { last15m: 1, open: 1 } }, {}, now)[0]?.severity, "warning");
    assert.equal(alertConditions({ ...base, errors: { last15m: 6, open: 6 } }, {}, now)[0]?.severity, "critical");
  });
  it("cron missing after its gap; failing after a streak; jobs never seen are ignored", () => {
    const late = alertConditions({ ...base, cron: [job({ lastRunAt: new Date(now.getTime() - 15 * 60_000) })] }, { "/api/cron/outbox": 10 }, now);
    assert.equal(late[0]?.key, "cron_missing:/api/cron/outbox");
    const failing = alertConditions({ ...base, cron: [job({ lastOk: false, lastSuccessAt: new Date(now.getTime() - 45 * 60_000) })] }, { "/api/cron/outbox": 10 }, now);
    assert.equal(failing[0]?.key, "cron_failing:/api/cron/outbox");
    const blip = alertConditions({ ...base, cron: [job({ lastOk: false, lastSuccessAt: new Date(now.getTime() - 2 * 60_000) })] }, { "/api/cron/outbox": 10 }, now);
    assert.equal(blip.length, 0, "one failed run isn't an alert");
    assert.equal(alertConditions(base, { "/api/cron/billing": 130 }, now).length, 0);
  });
});

describe("error grouping", () => {
  it("strips ids, numbers and quoted values", () => {
    assert.equal(
      normalizeErrorMessage('Order 0b6f6a52-6d4c-4c3e-9a2e-0d1f5a7b9c11 failed after 3 tries: "boom"'),
      normalizeErrorMessage('Order 11111111-2222-3333-4444-555555555555 failed after 12 tries: "other"')
    );
  });
});

describe("plan lifecycle", () => {
  const d = (days: number) => new Date(now.getTime() + days * 86_400_000);
  it("plan states", () => {
    assert.equal(planStatusOf("free", d(5), now).state, "free");
    assert.equal(planStatusOf("growth", null, now).state, "manual");
    assert.equal(planStatusOf("growth", d(20), now).state, "active");
    const exp = planStatusOf("pro", d(2.5), now);
    assert.equal(exp.state, "expiring");
    assert.equal(exp.daysLeft, 3);
    const grace = planStatusOf("pro", d(-2), now);
    assert.equal(grace.state, "grace");
    assert.equal(grace.daysLeft, PLAN_GRACE_DAYS - 2);
  });
  it("the most urgent notice due", () => {
    assert.equal(dueNoticeKind(d(10), now), null);
    assert.equal(dueNoticeKind(d(6), now), "reminder_7");
    assert.equal(dueNoticeKind(d(2), now), "reminder_3");
    assert.equal(dueNoticeKind(d(0.5), now), "reminder_1");
    assert.equal(dueNoticeKind(d(-1), now), "expired");
    assert.equal(dueNoticeKind(d(-PLAN_GRACE_DAYS), now), "downgraded");
  });
});

describe("status page mapping", () => {
  it("maps alerts to public parts and impacts to states", () => {
    assert.equal(componentForAlert("sms_failures"), "notifications");
    assert.equal(componentForAlert("webhook_backlog"), "api");
    assert.equal(componentForAlert("cron_missing:/api/cron/marketplaces"), "channels");
    assert.equal(componentForAlert("app_errors"), null, "internal only");
    assert.equal(incidentState("major"), "major_outage");
    assert.equal(incidentState("maintenance"), "maintenance");
  });
});
