# Runbook — backups and restore drill (Neon)

Guma Kart's data lives in one Neon Postgres project (production branch). Neon keeps a
point-in-time history (the "restore window", 7 days on Launch, longer on Scale — check the plan in
the Neon console). Nothing else needs backing up: uploads are in Cloudflare R2, and code + migrations
are in git.

## Quarterly drill (≈20 minutes) — and the same steps for a real restore

1. **Pick a time.** Neon console → project → Branches → *Create branch* → "Point in time" →
   choose a time (for the drill: one hour ago; for a real incident: just before the bad change).
   Name it `restore-YYYY-MM-DD`. This never touches production.
2. **Copy the branch's connection string** (pooled is fine). Keep it out of chat, docs and commits.
3. **Check the restore** from the repo on your machine:

   ```powershell
   $env:RESTORE_DATABASE_URL = "<branch connection string>"
   pnpm --filter @gumakart/db restore-check
   Remove-Item Env:RESTORE_DATABASE_URL
   ```

   It is read-only. It checks every migration is present, the main tables have rows, the newest
   order is recent, and the money/stock rules hold (no negative stock, totals add up, refunds never
   exceed totals, every order has items, no cross-shop items). It prints PASS/FAIL per check and
   exits 1 on any failure.
4. **Record the drill** below (date, restore point, result, minutes taken).
5. **Delete the branch** in the Neon console (branches cost storage).

## Real incident: putting a restore live

Only after the check passes, and with the sites in maintenance:

1. Post an incident on ops.guma.one → Status page ("Planned maintenance" or "Major").
2. Either promote the restored branch to primary in Neon (*Set as primary*), or point the
   Cloudflare Hyperdrive config `gumakart-db` at the restored branch's connection string
   (Cloudflare dashboard → Hyperdrive → gumakart-db → Edit). Hyperdrive is used by all three Workers.
3. Run `pnpm --filter @gumakart/db migrate` against it (no-op if nothing is missing).
4. Smoke test: sign in to admin, open Orders, place a test checkout on a demo shop, check
   ops.guma.one → System health shows no new errors.
5. Resolve the incident with a short note of what was lost (orders between the restore point and
   the incident must be re-entered from Messenger/Shopee/POS receipts).

## Drill log

| Date | Restore point | Result | Minutes | By |
|---|---|---|---|---|
| _first drill pending_ | | | | |
