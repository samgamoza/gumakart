import assert from "node:assert/strict";
import { test } from "node:test";
import { CRON_JOBS, cronExpectations, dueJobs, summarizeCronBody } from "./cron-schedule";

const at = (iso: string) => Date.parse(iso) + 17_000; // seconds inside the minute don't matter
const paths = (iso: string) => dueJobs(at(iso)).map((j) => j.path);

test("cron schedule (one every-minute trigger)", async (t) => {
  await t.test("outbox and webhooks every minute, 5-minute jobs on :x0/:x5", () => {
    assert.deepEqual(paths("2026-10-06T03:01:00Z"), ["/api/cron/outbox", "/api/cron/webhooks"]);
    assert.deepEqual(paths("2026-10-06T03:05:00Z"), ["/api/cron/outbox", "/api/cron/webhooks", "/api/cron/automations", "/api/cron/marketplaces", "/api/cron/campaigns"]);
  });
  await t.test("hourly jobs at their minute; daily/weekly at their hour", () => {
    assert.ok(paths("2026-10-06T03:20:00Z").includes("/api/cron/expire-orders"));
    assert.ok(paths("2026-10-06T03:50:00Z").includes("/api/cron/billing"));
    assert.ok(paths("2026-10-06T09:00:00Z").includes("/api/cron/agent-reminders"));
    assert.ok(paths("2026-10-05T02:00:00Z").includes("/api/cron/agents?mode=weekly"), "Monday 02:00 UTC");
    assert.ok(!paths("2026-10-06T02:00:00Z").includes("/api/cron/agents?mode=weekly"));
  });
  await t.test("every job is due at least once within its max gap", () => {
    const start = Date.parse("2026-10-05T00:00:00Z");
    for (const job of CRON_JOBS) {
      let last = start;
      let maxGap = 0;
      for (let m = 0; m < 8 * 24 * 60; m++) {
        const ts = start + m * 60_000;
        if (job.due(new Date(ts))) {
          maxGap = Math.max(maxGap, (ts - last) / 60_000);
          last = ts;
        }
      }
      assert.ok(maxGap <= job.maxGapMinutes, `${job.path}: gap ${maxGap} > ${job.maxGapMinutes}`);
    }
    assert.equal(cronExpectations()["/api/cron/outbox"], 10);
  });
  await t.test("summaries keep short scalar fields only", () => {
    assert.equal(summarizeCronBody('{"ok":true,"sent":3,"failed":0,"rows":[1,2],"note":"fine"}'), "sent=3 failed=0 note=fine");
    assert.equal(summarizeCronBody("<html>502</html>"), "<html>502</html>");
  });
});
