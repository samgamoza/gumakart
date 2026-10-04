-- Phase 2 verification queries (docs/PHASE-2-MIGRATION-SPEC.md §6).
-- Run after 0021+0022, then daily during the dual-write week. Every query must
-- return 0 rows before applying 0023, and again before 0024.

-- V1: orders missing a state
SELECT id, order_number FROM orders
WHERE order_state IS NULL OR payment_state IS NULL OR fulfillment_state IS NULL;

-- V2: legacy columns drifted from the new ones (same CASE as 0022 / legacyStatusOf)
SELECT id, order_number, status, payment_status, order_state, payment_state, fulfillment_state FROM orders o
WHERE o.status::text <> (CASE
    WHEN o.order_state = 'cancelled' AND o.payment_state = 'refunded' THEN 'refunded'
    WHEN o.order_state = 'cancelled' THEN 'cancelled'
    WHEN o.order_state = 'completed' THEN 'delivered'
    WHEN o.fulfillment_state = 'delivered' THEN 'delivered'
    WHEN o.fulfillment_state IN ('picked_up', 'out_for_delivery', 'failed_delivery', 'returned') THEN 'out_for_delivery'
    WHEN o.fulfillment_state = 'ready' THEN 'ready_for_pickup'
    WHEN o.accepted_at IS NOT NULL THEN 'accepted'
    WHEN o.payment_state = 'paid' THEN 'paid'
    WHEN o.payment_state = 'cod_due' THEN 'accepted'
    ELSE 'pending_payment' END)
  OR coalesce(o.payment_status::text, 'pending') <> (CASE o.payment_state
    WHEN 'paid' THEN 'paid' WHEN 'failed' THEN 'failed'
    WHEN 'refunded' THEN 'refunded' WHEN 'partially_refunded' THEN 'refunded'
    ELSE 'pending' END);

-- V3: completed orders that aren't paid + delivered
SELECT id, order_number FROM orders
WHERE order_state = 'completed' AND NOT (payment_state = 'paid' AND fulfillment_state = 'delivered');

-- V4: orders with more than one live charge row
SELECT order_id, count(*) FROM payment_transactions
WHERE status IN ('pending', 'processing', 'paid')
  AND coalesce(gateway_intent_id, '') NOT LIKE 'pos\_%'  -- POS split tender: up to 2 rows (Phase 5)
GROUP BY order_id HAVING count(*) > 1;

-- V5: stock ledger vs counter (tracked variants with an opening balance)
SELECT v.id, v.stock_qty, sum(m.delta) AS ledger
FROM product_variants v
JOIN products p ON p.id = v.product_id AND p.track_inventory
JOIN stock_movements m ON m.variant_id = v.id
GROUP BY v.id, v.stock_qty
HAVING coalesce(v.stock_qty, 0) <> sum(m.delta)
   AND bool_or(m.reason = 'initial');
