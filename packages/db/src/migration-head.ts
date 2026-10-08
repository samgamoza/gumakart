/**
 * Phase 19: the newest migration this code needs. Kept in step with drizzle/meta/_journal.json by
 * migration-journal.test.ts — when you add a migration, update this too (the test tells you).
 * The live app compares it with drizzle.__drizzle_migrations to catch code deployed ahead of
 * its migration.
 */
export const MIGRATION_HEAD = { tag: "0043_security_g1", when: 1787400000000 } as const;
