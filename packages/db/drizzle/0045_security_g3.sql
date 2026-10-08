-- Security slice G3 (audit 2026-10-07: GK-20). Tamper-evident audit.
--
-- 1. audit_events: one append-only log, hash-chained PER SHOP (tenant_id, or the zero uuid for
--    platform/ops events), written by triggers inside the same transaction as the action it
--    records — an action without its audit row cannot commit, and an edit or removal of history
--    is detectable with audit_chain_verify().
-- 2. What gets written: every activity_log and platform_audit_log row (so existing app logging
--    is chained automatically), order state changes, payment, payout and gateway-refund status
--    changes, wallet ledger rows, user role/status/password/2FA/session changes, tenant status,
--    KYC decisions, product price changes.
-- 3. Refuse-change triggers on the logs and ledgers: activity_log, platform_audit_log,
--    order_status_history, stock_movements, audit_events (append-only); wallet_ledger_entries
--    (only status may change), gateway_refunds (only send-state columns), payment_transactions
--    (never deleted; money frozen once paid), tenant_payouts (never deleted; amount frozen).
-- 4. audit_chain_verify(tenant) and run_audit_chain_check() with audit_chain_checks; the ops cron
--    also prints each shop's chain head to the Worker logs (outside the database).
-- 5. cron_locks + try_cron_lock(name) so scheduled jobs never overlap.
--
-- Everything is additive; no table rewrites.

CREATE TABLE IF NOT EXISTS "audit_events" (
  "seq" bigserial PRIMARY KEY,
  "id" uuid DEFAULT gen_random_uuid() NOT NULL UNIQUE,
  "tenant_id" uuid,
  "actor_id" uuid,
  "actor_label" varchar(120),
  "action" varchar(80) NOT NULL,
  "entity_type" varchar(40) NOT NULL,
  "entity_id" varchar(64),
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "prev_hash" varchar(64) NOT NULL,
  "hash" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_tenant_idx" ON "audit_events" ("tenant_id", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_entity_idx" ON "audit_events" ("entity_type", "entity_id", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_actor_idx" ON "audit_events" ("actor_id", "seq");
--> statement-breakpoint
-- The chain. One advisory lock per shop, so shops never wait on each other.
CREATE OR REPLACE FUNCTION audit_events_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_prev text; v_key uuid := coalesce(NEW.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_events'), hashtext(v_key::text));
  SELECT hash INTO v_prev FROM audit_events WHERE coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_key ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := coalesce(v_prev, repeat('0', 64));
  NEW.created_at := coalesce(NEW.created_at, now());
  NEW.hash := encode(sha256(convert_to(
    NEW.prev_hash || '|' || NEW.id::text || '|' || coalesce(NEW.tenant_id::text, '') || '|' || coalesce(NEW.actor_id::text, '') || '|' ||
    coalesce(NEW.actor_label, '') || '|' || NEW.action || '|' || NEW.entity_type || '|' || coalesce(NEW.entity_id, '') || '|' ||
    NEW.details::text || '|' || NEW.created_at::text, 'utf8')), 'hex');
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_events_chain" ON "audit_events";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_events_chain" BEFORE INSERT ON "audit_events" FOR EACH ROW EXECUTE FUNCTION audit_events_chain();
--> statement-breakpoint
-- app.audit_bypass: a per-connection switch for the local test database only (test clean-up
-- deletes fixture rows). It is never set by the apps; the chain itself and its checks ignore it.
CREATE OR REPLACE FUNCTION audit_bypass() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.audit_bypass', true), '') = 'on';
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME NOT IN ('audit_events', 'audit_chain_checks') AND audit_bypass() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_events_immutable" ON "audit_events";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_events_immutable" BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
-- Writer used by every trigger below (and by the app for logins, 2FA, support access).
CREATE OR REPLACE FUNCTION audit_event(p_tenant_id uuid, p_actor_id uuid, p_actor_label text, p_action text, p_entity_type text, p_entity_id text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO audit_events (tenant_id, actor_id, actor_label, action, entity_type, entity_id, details)
  VALUES (p_tenant_id, p_actor_id, left(p_actor_label, 120), left(p_action, 80), left(p_entity_type, 40), left(p_entity_id, 64), coalesce(p_details, '{}'::jsonb));
$$;
--> statement-breakpoint
-- 2. Mirrors -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mirror_activity_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM audit_event(NEW.tenant_id, NEW.actor_user_id, NEW.actor_name, NEW.action, coalesce(NEW.entity_type, 'activity'), NEW.entity_id,
    jsonb_build_object('summary', NEW.summary, 'role', NEW.actor_role, 'meta', coalesce(NEW.meta_json, '{}'::jsonb), 'activity_log_id', NEW.id));
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_activity_log" ON "activity_log";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_activity_log" AFTER INSERT ON "activity_log" FOR EACH ROW EXECUTE FUNCTION audit_mirror_activity_log();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_mirror_platform_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM audit_event(NEW.tenant_id, NEW.actor_id, coalesce(NEW.actor_email, NEW.actor_type::text), NEW.action, NEW.entity_type, NEW.entity_id::text,
    jsonb_build_object('label', NEW.entity_label, 'meta', coalesce(NEW.metadata_json, '{}'::jsonb), 'platform_audit_log_id', NEW.id));
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_platform_audit" ON "platform_audit_log";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_platform_audit" AFTER INSERT ON "platform_audit_log" FOR EACH ROW EXECUTE FUNCTION audit_mirror_platform_audit();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_orders_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_state IS DISTINCT FROM OLD.order_state OR NEW.payment_state IS DISTINCT FROM OLD.payment_state
     OR NEW.fulfillment_state IS DISTINCT FROM OLD.fulfillment_state OR NEW.total IS DISTINCT FROM OLD.total
     OR NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount THEN
    PERFORM audit_event(NEW.tenant_id, NULL, 'system', 'order.changed', 'order', NEW.id::text, jsonb_build_object(
      'order_number', NEW.order_number,
      'from', jsonb_build_object('order', OLD.order_state, 'payment', OLD.payment_state, 'fulfillment', OLD.fulfillment_state, 'total', OLD.total, 'refunded', OLD.refunded_amount),
      'to',   jsonb_build_object('order', NEW.order_state, 'payment', NEW.payment_state, 'fulfillment', NEW.fulfillment_state, 'total', NEW.total, 'refunded', NEW.refunded_amount)));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_orders_change" ON "orders";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_orders_change" AFTER UPDATE OF order_state, payment_state, fulfillment_state, total, refunded_amount ON "orders" FOR EACH ROW EXECUTE FUNCTION audit_orders_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tenant uuid; v_amount text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_tenant := NEW.tenant_id;
    BEGIN v_amount := NEW.amount::text; EXCEPTION WHEN OTHERS THEN v_amount := NULL; END;
    PERFORM audit_event(v_tenant, NULL, 'system', TG_TABLE_NAME || '.status', TG_TABLE_NAME, NEW.id::text,
      jsonb_build_object('from', OLD.status, 'to', NEW.status, 'amount', v_amount));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_payment_transactions_status" ON "payment_transactions";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_payment_transactions_status" AFTER UPDATE OF status ON "payment_transactions" FOR EACH ROW EXECUTE FUNCTION audit_status_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_tenant_payouts_status" ON "tenant_payouts";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_tenant_payouts_status" AFTER UPDATE OF status ON "tenant_payouts" FOR EACH ROW EXECUTE FUNCTION audit_status_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_gateway_refunds_status" ON "gateway_refunds";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_gateway_refunds_status" AFTER UPDATE OF status ON "gateway_refunds" FOR EACH ROW EXECUTE FUNCTION audit_status_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_kyc_status" ON "kyc_verification_sessions";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_kyc_status" AFTER UPDATE OF status ON "kyc_verification_sessions" FOR EACH ROW EXECUTE FUNCTION audit_status_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_payout_requested() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM audit_event(NEW.tenant_id, NULL, 'system', 'payout.requested', 'tenant_payouts', NEW.id::text,
    jsonb_build_object('amount', NEW.amount, 'method', NEW.method, 'destination_last4', right(NEW.destination_account, 4), 'auto', NEW.auto_triggered));
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_payout_requested" ON "tenant_payouts";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_payout_requested" AFTER INSERT ON "tenant_payouts" FOR EACH ROW EXECUTE FUNCTION audit_payout_requested();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_wallet_ledger_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM audit_event(NEW.tenant_id, NULL, 'system', 'wallet.' || NEW.type::text, 'wallet_ledger_entries', NEW.id::text,
    jsonb_build_object('status', NEW.status, 'net', NEW.net_amount, 'gross', NEW.gross_amount, 'fee', NEW.fee_amount, 'order_id', NEW.order_id, 'reference', NEW.reference));
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_wallet_ledger_insert" ON "wallet_ledger_entries";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_wallet_ledger_insert" AFTER INSERT ON "wallet_ledger_entries" FOR EACH ROW EXECUTE FUNCTION audit_wallet_ledger_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_users_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_changes jsonb := '{}'::jsonb;
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN v_changes := v_changes || jsonb_build_object('role', jsonb_build_array(OLD.role, NEW.role)); END IF;
  IF NEW.staff_role IS DISTINCT FROM OLD.staff_role THEN v_changes := v_changes || jsonb_build_object('staff_role', jsonb_build_array(OLD.staff_role, NEW.staff_role)); END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN v_changes := v_changes || jsonb_build_object('status', jsonb_build_array(OLD.status, NEW.status)); END IF;
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN v_changes := v_changes || '{"password": "changed"}'::jsonb; END IF;
  IF NEW.totp_enabled_at IS DISTINCT FROM OLD.totp_enabled_at THEN v_changes := v_changes || jsonb_build_object('two_factor', CASE WHEN NEW.totp_enabled_at IS NULL THEN 'disabled' ELSE 'enabled' END); END IF;
  IF NEW.session_version IS DISTINCT FROM OLD.session_version THEN v_changes := v_changes || '{"sessions": "ended"}'::jsonb; END IF;
  IF v_changes <> '{}'::jsonb THEN
    PERFORM audit_event(NEW.tenant_id, NULL, 'system', 'user.changed', 'user', NEW.id::text, v_changes);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_users_change" ON "users";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_users_change" AFTER UPDATE OF role, staff_role, status, password_hash, totp_enabled_at, session_version ON "users" FOR EACH ROW EXECUTE FUNCTION audit_users_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_tenants_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM audit_event(NEW.id, NULL, 'system', 'tenant.status', 'tenant', NEW.id::text, jsonb_build_object('from', OLD.status, 'to', NEW.status));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_tenants_change" ON "tenants";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_tenants_change" AFTER UPDATE OF status ON "tenants" FOR EACH ROW EXECUTE FUNCTION audit_tenants_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_variant_price() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tenant uuid;
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price THEN
    SELECT tenant_id INTO v_tenant FROM products WHERE id = NEW.product_id;
    PERFORM audit_event(v_tenant, NULL, 'system', 'variant.price', 'product_variant', NEW.id::text, jsonb_build_object('from', OLD.price, 'to', NEW.price, 'product_id', NEW.product_id));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_variant_price" ON "product_variants";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_variant_price" AFTER UPDATE OF price ON "product_variants" FOR EACH ROW EXECUTE FUNCTION audit_variant_price();
--> statement-breakpoint
-- 3. Append-only logs and frozen ledgers ------------------------------------------------
DROP TRIGGER IF EXISTS "trg_activity_log_immutable" ON "activity_log";
--> statement-breakpoint
CREATE TRIGGER "trg_activity_log_immutable" BEFORE UPDATE OR DELETE ON "activity_log" FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_platform_audit_log_immutable" ON "platform_audit_log";
--> statement-breakpoint
CREATE TRIGGER "trg_platform_audit_log_immutable" BEFORE UPDATE OR DELETE ON "platform_audit_log" FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_order_status_history_immutable" ON "order_status_history";
--> statement-breakpoint
CREATE TRIGGER "trg_order_status_history_immutable" BEFORE UPDATE OR DELETE ON "order_status_history" FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stock_movements_immutable" ON "stock_movements";
--> statement-breakpoint
CREATE TRIGGER "trg_stock_movements_immutable" BEFORE UPDATE OR DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION wallet_ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF audit_bypass() THEN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'wallet_ledger_entries is append-only'; END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.payout_id IS DISTINCT FROM OLD.payout_id
     OR NEW.type <> OLD.type OR NEW.gross_amount <> OLD.gross_amount OR NEW.fee_amount <> OLD.fee_amount OR NEW.net_amount <> OLD.net_amount
     OR NEW.reference IS DISTINCT FROM OLD.reference OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'wallet_ledger_entries: only the status of an entry may change';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_wallet_ledger_guard" ON "wallet_ledger_entries";
--> statement-breakpoint
CREATE TRIGGER "trg_wallet_ledger_guard" BEFORE UPDATE OR DELETE ON "wallet_ledger_entries" FOR EACH ROW EXECUTE FUNCTION wallet_ledger_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION gateway_refunds_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF audit_bypass() THEN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'gateway_refunds is append-only'; END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.order_id <> OLD.order_id OR NEW.return_id IS DISTINCT FROM OLD.return_id OR NEW.kind <> OLD.kind
     OR NEW.gateway <> OLD.gateway OR NEW.gateway_payment_id <> OLD.gateway_payment_id OR NEW.amount <> OLD.amount OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'gateway_refunds: only the send state may change';
  END IF;
  IF OLD.status = 'sent' AND (NEW.status <> 'sent' OR NEW.gateway_refund_id IS DISTINCT FROM OLD.gateway_refund_id) THEN
    RAISE EXCEPTION 'a sent gateway refund is frozen';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_gateway_refunds_guard" ON "gateway_refunds";
--> statement-breakpoint
CREATE TRIGGER "trg_gateway_refunds_guard" BEFORE UPDATE OR DELETE ON "gateway_refunds" FOR EACH ROW EXECUTE FUNCTION gateway_refunds_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payment_transactions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF audit_bypass() THEN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payment_transactions rows are never deleted'; END IF;
  IF NEW.order_id <> OLD.order_id OR NEW.tenant_id <> OLD.tenant_id THEN RAISE EXCEPTION 'a payment cannot move to another order'; END IF;
  IF OLD.status = 'paid' AND (NEW.amount <> OLD.amount OR NEW.currency <> OLD.currency OR NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
    RAISE EXCEPTION 'a paid payment is frozen; record a refund instead';
  END IF;
  IF OLD.status = 'paid' AND NEW.status NOT IN ('paid', 'refunded') THEN
    RAISE EXCEPTION 'a paid payment can only move to refunded';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_payment_transactions_guard" ON "payment_transactions";
--> statement-breakpoint
CREATE TRIGGER "trg_payment_transactions_guard" BEFORE UPDATE OR DELETE ON "payment_transactions" FOR EACH ROW EXECUTE FUNCTION payment_transactions_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION tenant_payouts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF audit_bypass() THEN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'tenant_payouts rows are never deleted'; END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.amount <> OLD.amount OR NEW.destination_account <> OLD.destination_account OR NEW.method <> OLD.method OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a payout request is frozen; cancel it and make a new one';
  END IF;
  IF OLD.status = 'completed' AND NEW.status <> 'completed' THEN RAISE EXCEPTION 'a completed payout cannot be reopened'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_tenant_payouts_guard" ON "tenant_payouts";
--> statement-breakpoint
CREATE TRIGGER "trg_tenant_payouts_guard" BEFORE UPDATE OR DELETE ON "tenant_payouts" FOR EACH ROW EXECUTE FUNCTION tenant_payouts_guard();
--> statement-breakpoint
-- 4. Verification ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_chain_verify(p_tenant_id uuid DEFAULT NULL)
RETURNS TABLE (ok boolean, checked bigint, first_bad_seq bigint, problem text, last_seq bigint, last_hash text)
LANGUAGE plpgsql STABLE AS $$
DECLARE r record; v_prev text := repeat('0', 64); v_hash text; v_n bigint := 0; v_last bigint := 0;
  v_key uuid := coalesce(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  ok := true; checked := 0; first_bad_seq := NULL; problem := NULL; last_seq := NULL; last_hash := NULL;
  FOR r IN SELECT * FROM audit_events a WHERE coalesce(a.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_key ORDER BY a.seq LOOP
    v_n := v_n + 1;
    IF r.prev_hash <> v_prev THEN
      ok := false; checked := v_n; first_bad_seq := r.seq; problem := 'prev_hash does not match the previous row'; last_seq := v_last; last_hash := v_prev; RETURN NEXT; RETURN;
    END IF;
    v_hash := encode(sha256(convert_to(
      r.prev_hash || '|' || r.id::text || '|' || coalesce(r.tenant_id::text, '') || '|' || coalesce(r.actor_id::text, '') || '|' ||
      coalesce(r.actor_label, '') || '|' || r.action || '|' || r.entity_type || '|' || coalesce(r.entity_id, '') || '|' ||
      r.details::text || '|' || r.created_at::text, 'utf8')), 'hex');
    IF v_hash <> r.hash THEN
      ok := false; checked := v_n; first_bad_seq := r.seq; problem := 'row contents do not match its hash'; last_seq := v_last; last_hash := v_prev; RETURN NEXT; RETURN;
    END IF;
    v_prev := r.hash; v_last := r.seq;
  END LOOP;
  checked := v_n; last_seq := v_last; last_hash := v_prev;
  RETURN NEXT;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_chain_checks" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" uuid,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ok" boolean NOT NULL,
  "checked" bigint NOT NULL,
  "first_bad_seq" bigint,
  "problem" varchar(300),
  "last_seq" bigint,
  "last_hash" varchar(64)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_chain_checks_tenant_idx" ON "audit_chain_checks" ("tenant_id", "id");
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit_chain_checks_immutable" ON "audit_chain_checks";
--> statement-breakpoint
CREATE TRIGGER "trg_audit_chain_checks_immutable" BEFORE UPDATE OR DELETE ON "audit_chain_checks" FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
-- Checks every shop's chain (and the platform chain) against the previously recorded head, so a
-- tail that was rewritten and re-hashed consistently is still caught. Returns one row per chain.
CREATE OR REPLACE FUNCTION run_audit_chain_check()
RETURNS TABLE (tenant_id uuid, ok boolean, checked bigint, problem text, last_seq bigint, last_hash text)
LANGUAGE plpgsql AS $$
DECLARE t record; v record; v_prev record; v_key uuid;
BEGIN
  FOR t IN SELECT DISTINCT coalesce(a.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) AS key FROM audit_events a LOOP
    v_key := t.key;
    SELECT * INTO v FROM audit_chain_verify(CASE WHEN v_key = '00000000-0000-0000-0000-000000000000'::uuid THEN NULL ELSE v_key END);
    SELECT * INTO v_prev FROM audit_chain_checks c WHERE coalesce(c.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_key ORDER BY c.id DESC LIMIT 1;
    IF v.ok AND v_prev.id IS NOT NULL AND v_prev.ok AND coalesce(v_prev.last_seq, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.seq = v_prev.last_seq AND a.hash = v_prev.last_hash) THEN
      v.ok := false; v.problem := 'the chain was rewritten since the previous check'; v.first_bad_seq := v_prev.last_seq;
    END IF;
    INSERT INTO audit_chain_checks (tenant_id, ok, checked, first_bad_seq, problem, last_seq, last_hash)
    VALUES (CASE WHEN v_key = '00000000-0000-0000-0000-000000000000'::uuid THEN NULL ELSE v_key END, v.ok, v.checked, v.first_bad_seq, v.problem, v.last_seq, v.last_hash);
    tenant_id := CASE WHEN v_key = '00000000-0000-0000-0000-000000000000'::uuid THEN NULL ELSE v_key END;
    ok := v.ok; checked := v.checked; problem := v.problem; last_seq := v.last_seq; last_hash := v.last_hash;
    RETURN NEXT;
  END LOOP;
  RETURN;
END $$;
--> statement-breakpoint
-- 5. Cron locks ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "cron_locks" (
  "name" varchar(64) PRIMARY KEY,
  "locked_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "holder" varchar(64)
);
--> statement-breakpoint
-- TRUE when the caller now holds the lock for ttl seconds; FALSE while another run holds it.
CREATE OR REPLACE FUNCTION try_cron_lock(p_name text, p_holder text, p_ttl_seconds int DEFAULT 900) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_got int;
BEGIN
  INSERT INTO cron_locks AS c (name, locked_at, expires_at, holder) VALUES (p_name, now(), now() + make_interval(secs => p_ttl_seconds), p_holder)
  ON CONFLICT (name) DO UPDATE SET locked_at = now(), expires_at = now() + make_interval(secs => p_ttl_seconds), holder = p_holder
    WHERE c.expires_at IS NULL OR c.expires_at < now();
  GET DIAGNOSTICS v_got = ROW_COUNT;
  RETURN v_got > 0;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION release_cron_lock(p_name text, p_holder text) RETURNS void LANGUAGE sql AS $$
  UPDATE cron_locks SET expires_at = NULL, holder = NULL WHERE name = p_name AND holder = p_holder;
$$;
