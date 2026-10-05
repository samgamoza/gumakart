-- Phase 16: operations. Cron run history, captured app errors, ops alerts, public status
-- incidents, plan billing notices and receipt numbers. Additive only.
CREATE TABLE IF NOT EXISTS "cron_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job" varchar(80) NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "duration_ms" integer NOT NULL,
  "ok" boolean NOT NULL,
  "status_code" integer,
  "summary" varchar(500),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cron_runs_job_idx" ON "cron_runs" ("job", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cron_runs_started_idx" ON "cron_runs" ("started_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_errors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "app" varchar(16) NOT NULL,
  "route" varchar(200),
  "message" varchar(500) NOT NULL,
  "stack" text,
  "count" integer DEFAULT 1 NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_errors_fingerprint_idx" ON "app_errors" ("fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_errors_last_seen_idx" ON "app_errors" ("last_seen_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" varchar(80) NOT NULL,
  "severity" varchar(10) NOT NULL,
  "title" varchar(200) NOT NULL,
  "detail" varchar(1000),
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "notified_at" timestamp with time zone,
  CONSTRAINT "ops_alerts_severity_check" CHECK ("severity" IN ('warning', 'critical'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ops_alerts_open_key_idx" ON "ops_alerts" ("key") WHERE "resolved_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_alerts_opened_idx" ON "ops_alerts" ("opened_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "status_incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" varchar(160) NOT NULL,
  "impact" varchar(12) NOT NULL,
  "status" varchar(14) DEFAULT 'investigating' NOT NULL,
  "components" text[] NOT NULL,
  "created_by" varchar(120),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  CONSTRAINT "status_incidents_impact_check" CHECK ("impact" IN ('minor', 'major', 'maintenance')),
  CONSTRAINT "status_incidents_status_check" CHECK ("status" IN ('investigating', 'identified', 'monitoring', 'resolved'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_incidents_created_idx" ON "status_incidents" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "status_incident_updates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "incident_id" uuid NOT NULL REFERENCES "status_incidents"("id") ON DELETE CASCADE,
  "status" varchar(14) NOT NULL,
  "message" varchar(1000) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_incident_updates_incident_idx" ON "status_incident_updates" ("incident_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_notices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "kind" varchar(16) NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "plan" varchar(50) NOT NULL,
  "email_sent" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_notices_unique_idx" ON "billing_notices" ("tenant_id", "kind", "period_end");
--> statement-breakpoint
ALTER TABLE "plan_payments" ADD COLUMN IF NOT EXISTS "receipt_number" varchar(24);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plan_payments_receipt_idx" ON "plan_payments" ("receipt_number");
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "plan_receipt_seq";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenants_plan_expiry_idx" ON "tenants" ("plan_expires_at") WHERE "plan_expires_at" IS NOT NULL;
