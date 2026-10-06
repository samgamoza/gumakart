import { sql } from "drizzle-orm";
import { getDb } from "../client";
import { MIGRATION_HEAD } from "../migration-head";

export interface SchemaStatus {
  /** The newest migration this code needs. */
  expected: { tag: string; when: number };
  /** `when` of the newest migration the database has applied (null = none / no table). */
  appliedWhen: number | null;
  /** True when the database has everything this code needs. */
  upToDate: boolean;
}

/** Phase 19: is the database migrated far enough for this code (or for a given migration)? */
export async function getSchemaStatus(): Promise<SchemaStatus> {
  let appliedWhen: number | null = null;
  try {
    const rows = (await getDb().execute(sql`select max(created_at)::text as w from drizzle.__drizzle_migrations`)) as unknown as Array<{ w: string | null }>;
    appliedWhen = rows[0]?.w != null ? Number(rows[0].w) : null;
  } catch {
    appliedWhen = null;
  }
  return { expected: { ...MIGRATION_HEAD }, appliedWhen, upToDate: appliedWhen != null && appliedWhen >= MIGRATION_HEAD.when };
}

/** True when a migration with this journal `when` has been applied (CI pre-deploy guard). */
export function isApplied(status: SchemaStatus, when: number): boolean {
  return status.appliedWhen != null && status.appliedWhen >= when;
}
