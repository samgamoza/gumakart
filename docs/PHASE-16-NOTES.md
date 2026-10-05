# Phase 16 — Operations: launch-safe

Roadmap: the Operations track in `claude/gumakart-roadmap.md`, run as its own phase after Phase 15.

**Before pushing:** run migration **0034_operations** on Neon (`pnpm --filter @gumakart/db migrate`).

- It adds these tables: `cron_runs`, `app_errors`, `ops_alerts`, `status_incidents`,
  `status_incident_updates` and `billing_notices`.
- It adds `plan_payments.receipt_number` and the `plan_receipt_seq` sequence.
- It adds a partial index on `tenants.plan_expires_at`.

The pending Phase 2 constraints are now `drizzle-pending/0035_…` (journal idx 35).

**The admin Worker's cron now runs every minute** (`wrangler.jsonc` `* * * * *`, was `*/5`).
`apps/admin/lib/cron-schedule.ts` decides which jobs run on each minute:

| Job | How often |
|---|---|
| Outbox, webhooks | Every minute |
| Automations, marketplaces, campaigns | Every 5 minutes |
| Expire-orders, wallet, billing | Hourly |
| Agents | Daily / weekly |

This deploys with the Worker and stays within the free plan's trigger count.

Optional secret: `OPS_ALERT_EMAIL` (admin). Alert emails go there, otherwise to `HELPDESK_NOTIFY_EMAIL`.
Sending them needs Resend.

## What shipped

### Monitoring and alerts (ops.guma.one → **System health**)

- **Run history.** The cron worker records every job run (time, OK/failed, short summary) by
  POSTing the tick's results to `/api/cron/ops`. History is kept 14 days.
- **Errors.** Server errors are grouped by app, route and message, ignoring ids and numbers. Three
  things feed them:
  - Next's `onRequestError` hook catches uncaught errors.
  - A `console.error` hook catches errors from catch blocks.
  - Explicit captures in the API and cron paths.

  The same Error object is counted once. "Mark fixed" closes a group; it reopens if the error
  happens again.
- **Alert rules.** They are checked every minute and alerts open and close by themselves:

  | Alert | Fires when |
  |---|---|
  | Order events gave up | Any event exhausted its retries (critical) |
  | Order events behind | Oldest is more than 15 minutes old |
  | Webhook events behind | Oldest is more than 15 minutes old |
  | SMS failures | More than 25% failed in the last hour (only with 10 or more sends) |
  | Server errors | Seen in the last 15 minutes (critical at 5 or more) |
  | Cron job missing | No run within its expected gap (critical) |
  | Cron job failing | Failing for 3 times its gap, or never succeeded (critical) |

  A cron job is only checked after it has run once, so local dev doesn't raise false alarms.
- **Notifications.** An email goes out when alerts open and when they resolve.
- **The page shows:** open and recent alerts, queue and SMS cards, a background-jobs table, the
  error list with stacks, and provider setup status.

### Public status page (kart.guma.one/status, plus `/api/status` JSON)

- **Parts listed:**
  - Checkout & online stores
  - Seller dashboard
  - POS
  - SMS & email
  - Online payments
  - Channels
  - API & webhooks
- **How each part's status is set:**
  - Incidents posted in ops.guma.one → **Status page** set the parts they name to minor, major or
    maintenance.
  - Automatic alerts mark the matching part "slow / delayed", without showing internal details.
- The page also shows live incidents with their timeline and the last 30 days of history.
- It is written in Taglish and refreshes every minute.

### Live billing (ready to hook up — PayMongo)

- **Paid plans** run 30 days per payment. Renewing early extends from the current end date.
- **Before the end:** emails go to the owner 7, 3 and 1 day(s) before. Each is sent once per period.
- **Banner:** in the 3 days before the end and during grace, owners see a banner at the top of the dashboard.
- **After the end:** 7 days of grace with everything still on, then the shop moves to Free. Nothing is
  deleted, and the downgrade is in the activity log.
- **Renewals:** a renewal that lands first is never undone. The downgrade only applies while the
  shop still has the same end date it had when the downgrade was decided.
- Plans set by ops with no end date never expire.
- **Settings → Plan** shows:
  - Plan status (active, ending, grace, or set by Guma Kart).
  - A **Renew** button, once `NEXT_PUBLIC_PLAN_BILLING_ENABLED=true`.
  - Payment history.
  - **Printable receipts** numbered `GK-2026-000001`. They are labelled as an acknowledgement, not a
    BIR official receipt, until Guma Kart's own BIR registration.
- The hourly `/api/cron/billing` job does the reminders and downgrades.

### Backups (`docs/RUNBOOK-BACKUPS.md`)

- Quarterly Neon point-in-time restore drill, with steps for a real restore (promote the branch,
  or repoint Hyperdrive).
- `pnpm --filter @gumakart/db restore-check` runs read-only checks against the restored branch:
  - Every migration is present.
  - The main tables have rows, and the newest order is recent.
  - No negative stock.
  - Order totals add up.
  - Refunds never exceed the order total.
  - Every order has items.
  - No order item points to another shop's product.

### Help centre (admin → **Help**, everyone can open it)

- 14 short Taglish how-tos: first order, checkout links, GCash/Maya confirmation, delivery, stock,
  POS, staff, SMS and consent, discounts, reports, channels, plan and renewal, API, getting
  support.
- Each article is searchable and links to the right page, the status page and a support ticket.

## Honest limits

- **Not real-time.** There is no Cloudflare Queues job runner yet. Running the cron every minute brings
  buyer SMS/email and webhooks to about 1 minute (was 5). Queues remain the next step if we need
  seconds.
- **Monitoring can't see a dead cron trigger.** If the whole trigger stops, there's no tick to
  notice it. Point an external uptime monitor at kart.guma.one/api/status and admin.guma.one/api/health
  (for example UptimeRobot, free).
- **Captured errors depend on the platform.** They rely on Next's instrumentation running on
  OpenNext. If it doesn't, explicit captures still cover the API and cron paths.
- **Billing emails need Resend.** Until then the banner and Settings → Plan still show everything.
  Payments need PayMongo live and `NEXT_PUBLIC_PLAN_BILLING_ENABLED=true`.
- **No dunning retries.** PayMongo doesn't auto-charge saved cards for GCash/Maya, so renewals stay
  manual (the reminders do the work).

## Tests

- db unit `operations.test.ts`: alert rules, error grouping, plan states and notice timing, status
  mapping.
- db integration `ops.test.ts`:
  - Cron history and error grouping/dedupe.
  - Alert open/keep/resolve.
  - Incidents and the public status.
  - Reminders once per period, grace, and downgrade.
  - A renewal that lands first is never undone.
  - Receipt numbers, receipt isolation, and webhook replay.
- admin `cron-schedule.test.ts`: per-minute schedule, that every job runs within its max gap, and summaries.
