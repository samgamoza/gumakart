import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Defense in depth for tenant isolation (CTO review 2026-11-16): every UPDATE or DELETE on a
 * shop-owned table names the shop in the same statement, so a missed check elsewhere can never
 * change another shop's rows. A statement that legitimately runs without a shop (a payment
 * webhook, a cron, a row just inserted in the same transaction) carries a comment on the line
 * before it: `// tenant-scope: system — <why>`.
 */
const TABLES = ["orders", "products", "customers", "checkoutLinks"];
const QUERIES = join(import.meta.dirname, "queries");

function unscopedWrites(file: string, source: string): string[] {
  const found: string[] = [];
  const re = new RegExp(String.raw`\.(update|delete)\((${TABLES.join("|")})\)`, "g");
  for (const m of source.matchAll(re)) {
    const start = m.index ?? 0;
    // A statement ends at the first line that ends with ";" (a ";" inside a template string doesn't count).
    const endMatch = /;[ \t]*(\r?\n|$)/.exec(source.slice(start));
    const statement = source.slice(start, endMatch ? start + endMatch.index : undefined);
    if (/tenantId|tenant_id/.test(statement)) continue;
    const before = source.slice(Math.max(0, source.lastIndexOf("\n", source.lastIndexOf("\n", start) - 1)), start);
    if (/tenant-scope: system/.test(before)) continue;
    const line = source.slice(0, start).split("\n").length;
    found.push(`${file}:${line} .${m[1]}(${m[2]})`);
  }
  return found;
}

describe("tenant scope on writes", () => {
  it("every update/delete on a shop-owned table names the shop", () => {
    const problems = readdirSync(QUERIES)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .flatMap((f) => unscopedWrites(f, readFileSync(join(QUERIES, f), "utf8")));
    assert.deepEqual(problems, [], `Add eq(<table>.tenantId, tenantId) to these, or a "// tenant-scope: system — why" comment:\n${problems.join("\n")}`);
  });
});
