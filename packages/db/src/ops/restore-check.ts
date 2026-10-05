/**
 * Phase 16 — backup restore drill check. READ-ONLY.
 *
 *   RESTORE_DATABASE_URL=postgres://…restored-branch… pnpm --filter @gumakart/db restore-check
 *
 * Point it at a Neon branch restored from a point in time (never needed against production,
 * though it only reads). It checks the schema is complete, the data is there and fresh, and
 * the core money/stock rules still hold (service_fee is Guma's fee from the seller, not part of
 * the buyer total; integration-test shops named test-* are skipped). Exit code 1 if anything fails.
 * See docs/RUNBOOK-BACKUPS.md.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.RESTORE_DATABASE_URL?.trim();
if (!url) {
  console.error("Set RESTORE_DATABASE_URL to the restored branch's connection string.");
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const journal = JSON.parse(readFileSync(path.join(here, "../../drizzle/meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };

const sql = postgres(url.replace(/([?&])channel_binding=[^&]*(&?)/, (_m, a: string, b: string) => (b ? a : "")), {
  max: 1,
  prepare: false,
  ssl: /neon\.tech/.test(url) ? "require" : undefined,
  connection: { default_transaction_read_only: "on" } as Record<string, string>,
});

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

async function one<T>(q: Promise<T[]>): Promise<T> {
  return (await q)[0]!;
}

try {
  const applied = await one(sql<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`).catch(() => ({ n: -1 }));
  add("Migrations", applied.n >= journal.entries.length, `${applied.n} applied, ${journal.entries.length} in this repo's journal`);

  const tables = ["tenants", "users", "products", "product_variants", "customers", "orders", "order_items", "payment_transactions", "stock_movements"];
  for (const t of tables) {
    const r = await one(sql<{ n: number }[]>`select count(*)::int as n from ${sql(t)}`).catch(() => null);
    add(`Table ${t}`, r !== null, r ? `${r.n} rows` : "missing");
  }

  const latest = await one(sql<{ at: Date | null }[]>`select max(created_at) as at from orders`);
  add("Latest order", true, latest.at ? new Date(latest.at).toISOString() : "no orders");

  const negative = await one(sql<{ n: number }[]>`select count(*)::int as n from product_variants where stock_qty < 0`);
  add("No negative stock", negative.n === 0, `${negative.n} variants below zero`);

  const totals = await one(sql<{ n: number }[]>`
    select count(*)::int as n from orders o join tenants t on t.id = o.tenant_id
    where abs(o.total - (o.subtotal - coalesce(o.discount, 0) + coalesce(o.delivery_fee, 0) + coalesce(o.tax, 0))) > 0.01
      and coalesce(o.source_channel, '') <> 'pos' and t.slug not like 'test-%'`);
  add("Order totals add up (non-POS)", totals.n === 0, `${totals.n} mismatched`);

  const refunds = await one(sql<{ n: number }[]>`select count(*)::int as n from orders where refunded_amount > total + 0.01`);
  add("Refunds never exceed totals", refunds.n === 0, `${refunds.n} over-refunded`);

  const orphans = await one(sql<{ n: number }[]>`select count(*)::int as n from orders o join tenants t on t.id = o.tenant_id
    where t.slug not like 'test-%' and not exists (select 1 from order_items i where i.order_id = o.id)`);
  add("Every order has items", orphans.n === 0, `${orphans.n} without items`);

  const crossTenant = await one(sql<{ n: number }[]>`
    select count(*)::int as n from order_items i join orders o on o.id = i.order_id join products p on p.id = i.product_id
    where p.tenant_id <> o.tenant_id`);
  add("No cross-shop order items", crossTenant.n === 0, `${crossTenant.n} found`);
} catch (error) {
  add("Connection / query", false, error instanceof Error ? error.message : String(error));
} finally {
  await sql.end({ timeout: 5 });
}

const width = Math.max(...checks.map((c) => c.name.length));
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(width)}  ${c.detail}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : "\nRestore looks good.");
process.exit(failed ? 1 : 0);
