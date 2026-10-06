/**
 * Phase 19: `pnpm db:status` — which migrations has this database applied, and what's pending?
 * Read-only. Uses the same repo-root .env as `pnpm db:migrate`; exits 1 when something is pending.
 *
 * How drizzle decides (drizzle-orm migrator): it only runs journal entries whose `when` is NEWER
 * than the newest row in drizzle.__drizzle_migrations. So:
 *  - newer than the newest applied row  → truly pending; `pnpm db:migrate` will run it.
 *  - older, but no row with its `when` or file hash → drizzle will never run it. Usually it was
 *    applied under an earlier timestamp (the journal was renumbered) or by hand. We check that the
 *    tables it creates exist and report it as a warning, not as pending.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "./client";

const here = path.dirname(fileURLToPath(import.meta.url));
// Same .env as `pnpm db:migrate` (drizzle.config.ts) — the repo root. Variables already set win.
config({ path: path.join(here, "../../../.env") });

const drizzleDir = path.join(here, "../drizzle");
const journal = JSON.parse(readFileSync(path.join(drizzleDir, "meta/_journal.json"), "utf8")) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};

function migrationFile(tag: string) {
  const text = readFileSync(path.join(drizzleDir, `${tag}.sql`), "utf8");
  return {
    hash: createHash("sha256").update(text).digest("hex"),
    tables: [...text.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? "([a-z0-9_]+)"/gi)].map((m) => m[1]!),
  };
}

async function main() {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").host || "(not set)";
    } catch {
      return "(unreadable DATABASE_URL)";
    }
  })();
  const db = getDb();
  let rows: Array<{ w: string; hash: string }>;
  try {
    rows = (await db.execute(sql`select created_at::text as w, hash from drizzle.__drizzle_migrations`)) as unknown as Array<{ w: string; hash: string }>;
  } catch (error) {
    console.error(`Could not read drizzle.__drizzle_migrations on ${host}:`, (error as Error).message);
    process.exitCode = 2;
    return;
  }
  const appliedWhen = new Set(rows.map((r) => Number(r.w)));
  const appliedHash = new Set(rows.map((r) => r.hash));
  const newestApplied = Math.max(0, ...appliedWhen);

  const unmatched = journal.entries.filter((e) => !appliedWhen.has(e.when) && !appliedHash.has(migrationFile(e.tag).hash));
  const pending = unmatched.filter((e) => e.when > newestApplied);
  const skipped = unmatched.filter((e) => e.when <= newestApplied);

  console.log(`Database: ${host}`);
  console.log(`Recorded by drizzle: ${journal.entries.length - unmatched.length}/${journal.entries.length} migrations in this repo.`);

  if (skipped.length) {
    let missingAny = false;
    console.log("\nRecorded under another timestamp (drizzle won't re-run these) — checking their tables:");
    for (const e of skipped) {
      const tables = migrationFile(e.tag).tables;
      const missing: string[] = [];
      for (const t of tables) {
        const [r] = (await db.execute(sql`select to_regclass(${`public.${t}`}) is not null as ok`)) as unknown as Array<{ ok: boolean }>;
        if (!r?.ok) missing.push(t);
      }
      if (missing.length) missingAny = true;
      console.log(
        `  ${missing.length ? "✗" : "✓"} ${e.tag}${tables.length === 0 ? " (no tables to check)" : missing.length ? ` — MISSING: ${missing.join(", ")}` : ` — ${tables.length} table(s) present`}`
      );
    }
    if (missingAny) {
      console.log("  Some tables are missing: this database is behind in a way `db:migrate` can't fix. Ask before pushing.");
      process.exitCode = 1;
    }
  }

  if (pending.length === 0) {
    if (!process.exitCode) console.log("\n✓ Up to date — safe to push.");
    return;
  }
  console.log("\nPending (run `pnpm db:migrate` before pushing):");
  for (const e of pending) console.log(`  - ${e.tag}`);
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => closeDb());
