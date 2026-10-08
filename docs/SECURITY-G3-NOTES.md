# Security slice G3 — tamper-evident audit (2026-10-09)

Source: the three-app security audit of 2026-10-07 (project doc `claude/security-audit-2026-10-07.md`), Guma Kart finding GK-20 and the "locks so cron jobs can't overlap" item.

**Migration:** `0045_security_g3` — `pnpm db:migrate` against Neon before pushing (additive: three tables and triggers; no rewrites). `MIGRATION_HEAD` points at it.
**Deploy:** admin (new cron route and locks, login/support-access events). The other apps pick up nothing new but share the database triggers.
**Local test database (once):** `ALTER DATABASE gumakart SET app.audit_bypass = 'on';` — fixture clean-up deletes rows the triggers would otherwise refuse. The apps never set it; the chain itself ignores it.

## What changed

### One hash-chained audit log: `audit_events`
Append-only, hash-chained **per shop** (`tenant_id`, with a platform chain for ops events), written by **database triggers inside the same transaction** as the action — so an action without its audit row cannot commit, and the write can no longer "silently drop" the way the old after-the-fact activity write could. Each row's `hash` covers the previous row's hash and its own contents; inserts are serialised per shop with an advisory lock, so shops never wait on each other.

What is chained:
- every `activity_log` and `platform_audit_log` row (all existing app logging — seller actions, ops actions, ops logins and 2FA enrolment — is chained automatically);
- order changes: state, payment state, fulfilment state, total, refunded amount (with from/to);
- payment, payout, gateway-refund and KYC status changes (with amounts); payout requests (method, last 4 of the destination); every wallet ledger row;
- user changes: role, staff role, status, **password changed**, **2FA enabled/disabled**, sessions ended;
- shop status changes; product variant price changes;
- app-written: seller **logins** (`auth.login`, with IP) and **support access** (`support.access`, in the shop's own chain).

Read with `listAuditEvents()`; the previous `activity_log` and `platform_audit_log` tables stay as the readable views the UI already uses.

### Append-only logs, frozen ledgers
`refuse_change` triggers on `activity_log`, `platform_audit_log`, `order_status_history`, `stock_movements`, `audit_events`, `audit_chain_checks`. Guards: `wallet_ledger_entries` may only change `status`; `gateway_refunds` only its send-state columns, and a sent refund is frozen; `payment_transactions` are never deleted, cannot move to another order, and once paid their amount/currency/`paid_at` are frozen (only `paid → refunded`); `tenant_payouts` are never deleted, amount/destination frozen, a completed payout can't be reopened.

### Daily verification with a copy outside the database
`audit_chain_verify(tenant)` walks one chain and names the first broken row. `run_audit_chain_check()` does every chain and **compares it with the head recorded by the previous check**, so a tail that was rewritten and re-hashed consistently is still caught; results go to `audit_chain_checks` (append-only). The admin cron `/api/cron/audit-chain` (daily 02:15 Manila) runs it and **prints every chain's head hash to the Worker log** — Cloudflare logs are outside the database, so a database-side rewrite that also rewrote the check table still disagrees with yesterday's log line. Ops can run `select * from audit_chain_verify('<tenant uuid>');` any time.

### Cron jobs never overlap
`withCronLock(name, fn, ttl)` on top of `cron_locks` / `try_cron_lock()`: outbox, webhooks, automations, marketplaces, campaigns, loyalty, expire-orders, wallet-settlement, billing and audit-chain each take their named lock; a second overlapping tick answers `skipped: "another run is still going"`. The TTL frees a lock whose run died.

## Verified
- Local Postgres with 0045 applied: `packages/db` integration suite 217/217 incl. new `security-g3.test.ts` — an activity row, a paid order (order change, payment status, wallet credit), a price change and a login all land in the shop's chain with each `prev_hash` = previous `hash`; edits/deletes of logs and ledgers are refused (bypass off), ledger status changes allowed, paid money frozen; a superuser edit with the trigger disabled is detected; a consistently re-hashed tail passes the walk but fails the daily check against the recorded head; three parallel cron runs → one runs, two skip, lock released. Unit suites db 107/107, admin 17/17 (schedule table includes the new job).
- `tsc` clean in db, admin, web, platform; admin `next build` OK.

## Still open (G4)
Ops 2FA bootstrap (GK-21), CI (GK-22), dependencies (GK-23), per-app secrets / workers.dev / token scope (GK-24), seed credentials (GK-25), headers/CSP (GK-10), payout-destination re-auth and masking bank numbers from staff.
