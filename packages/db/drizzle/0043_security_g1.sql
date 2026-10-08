-- Security slice G1 (audit 2026-10-07: GK-2, GK-9). Additive only, no table rewrites.
CREATE TABLE IF NOT EXISTS "rate_limits" (
  "key" varchar(200) PRIMARY KEY NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limits_expires_idx" ON "rate_limits" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consumed_tokens" (
  "jti" varchar(64) PRIMARY KEY NOT NULL,
  "purpose" varchar(32) NOT NULL,
  "consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consumed_tokens_expires_idx" ON "consumed_tokens" ("expires_at");
