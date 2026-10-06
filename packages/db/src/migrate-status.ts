/**
 * Phase 19: `pnpm db:status` — which migrations has this database applied, and what's pending?
 * Read-only. Point DATABASE_URL at Neon before pushing; exits 1 when something is pending.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "./client";

const here = path.dirname(fileURLToPath(import.meta.url));
// Same .env as `pnpm db:migrate` (drizzle.config.ts) — the repo root. Variables already set win.
config({ path: path.join(here, "../../../.env") });
const journal = JSON.parse(readFileSync(path.join(here, "../drizzle/meta/_journal.json"), "utf8")) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};

async function main() {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").host || "(not set)";
    } catch {
      return "(unreadable DATABASE_URL)";
    }
  })();
  let applied = new Set<number>();
  try {
    const rows = (await getDb().execute(sql`select created_at::text as w from drizzle.__drizzle_migrations`)) as unknown as Array<{ w: string }>;
    applied = new Set(rows.map((r) => Number(r.w)));
  } catch (error) {
    console.error(`Could not read drizzle.__drizzle_migrations on ${host}:`, (error as Error).message);
    process.exitCode = 2;
    return;
  }
  const pending = journal.entries.filter((e) => !applied.has(e.when));
  console.log(`Database: ${host}`);
  console.log(`Applied: ${journal.entries.length - pending.length}/${journal.entries.length} migrations in this repo.`);
  if (pending.length === 0) {
    console.log("✓ Up to date — safe to push.");
    return;
  }
  console.log("Pending (run `pnpm db:migrate` before pushing):");
  for (const e of pending) console.log(`  - ${e.tag}`);
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => closeDb());
