-- Email one-time codes (signup verification, re-verification of older accounts).
-- Additive only. Codes are stored as an HMAC, never in clear text.
CREATE TABLE IF NOT EXISTS "email_verification_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(255) NOT NULL,
  "purpose" varchar(24) NOT NULL,
  "code_hash" varchar(128) NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_codes_lookup_idx" ON "email_verification_codes" ("email", "purpose", "created_at");
