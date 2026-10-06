import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.join(here, "../drizzle");
const journalPath = path.join(drizzleDir, "meta/_journal.json");

function readJournal(): { entries: Array<{ idx: number; when: number; tag: string }> } {
  return JSON.parse(readFileSync(journalPath, "utf8"));
}

/**
 * Regression guards for the 2026-08-20 incident: `0002_nosy_ikaris.sql` existed
 * on disk but had no journal entry, so drizzle-kit silently skipped it. Existing
 * databases were fine (0002 had run before the entry went missing), but NO fresh
 * database could be built — `pnpm db:migrate` on an empty DB died at 0007, which
 * ALTERs a table 0002 creates. That breaks new dev setups, staging, and disaster
 * recovery, and nothing caught it because the tests below only asserted that a
 * few specific tags were present.
 */
describe("drizzle migration journal — structural integrity", () => {
  it("has an entry for every .sql migration file on disk", () => {
    const filesOnDisk = readdirSync(drizzleDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
    const tags = readJournal().entries.map((e) => e.tag).sort();
    const missing = filesOnDisk.filter((f) => !tags.includes(f));

    assert.deepEqual(
      missing,
      [],
      `migration file(s) on disk with no journal entry — drizzle-kit will silently skip these: ${missing.join(", ")}`
    );
  });

  it("has contiguous idx values starting at 0", () => {
    const idxs = readJournal().entries.map((e) => e.idx);
    const expected = Array.from({ length: idxs.length }, (_, i) => i);
    assert.deepEqual(idxs, expected, `journal idx values must be contiguous, got: ${idxs.join(", ")}`);
  });

  it("has strictly increasing timestamps", () => {
    const whens = readJournal().entries.map((e) => e.when);
    for (let i = 0; i < whens.length - 1; i += 1) {
      assert.ok(
        whens[i]! < whens[i + 1]!,
        `journal timestamps must strictly increase; entry ${i} (${whens[i]}) >= entry ${i + 1} (${whens[i + 1]}). ` +
          "drizzle-kit applies only migrations newer than the newest applied one, so out-of-order timestamps are silently skipped."
      );
    }
  });
});

describe("drizzle migration journal", () => {
  it("includes support helpdesk migration 0013", () => {
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const tags = journal.entries.map((e) => e.tag);
    assert.ok(
      tags.includes("0013_support_helpdesk"),
      `expected 0013_support_helpdesk in journal, got: ${tags.join(", ")}`
    );
  });

  it("includes template intelligence migration 0014", () => {
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const tags = journal.entries.map((e) => e.tag);
    assert.ok(
      tags.includes("0014_template_intelligence"),
      `expected 0014_template_intelligence in journal, got: ${tags.join(", ")}`
    );
  });

  it("includes product is_main migration 0015", () => {
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const tags = journal.entries.map((e) => e.tag);
    assert.ok(
      tags.includes("0015_product_is_main"),
      `expected 0015_product_is_main in journal, got: ${tags.join(", ")}`
    );
  });

  it("includes PH locations migration 0016", () => {
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const tags = journal.entries.map((e) => e.tag);
    assert.ok(
      tags.includes("0016_ph_locations"),
      `expected 0016_ph_locations in journal, got: ${tags.join(", ")}`
    );
  });
});

describe("Phase 19: MIGRATION_HEAD follows the journal", () => {
  it("names the newest journal entry (update src/migration-head.ts with each new migration)", async () => {
    const { MIGRATION_HEAD } = await import("./migration-head");
    const last = readJournal().entries.at(-1)!;
    assert.deepEqual({ tag: MIGRATION_HEAD.tag, when: MIGRATION_HEAD.when }, { tag: last.tag, when: last.when });
  });
});
