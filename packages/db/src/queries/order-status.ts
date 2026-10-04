/**
 * Order status vocabulary + the seller transition matrix.
 * Kept separate from orders.ts so order-lifecycle.ts can import it without a cycle.
 */

export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "accepted"
  | "preparing"
  | "ready_for_pickup"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "refunded";

/** Valid transitions a seller can make (enforced in order-lifecycle.ts). */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["paid", "cancelled"],
  // A paid order leaves through Refund, never a bare cancel.
  paid: ["accepted", "refunded"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready_for_pickup", "out_for_delivery", "cancelled"],
  ready_for_pickup: ["out_for_delivery", "delivered"],
  out_for_delivery: ["delivered"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export class OrderError extends Error {
  constructor(
    message: string,
    public code:
      | "TENANT_NOT_FOUND"
      | "TENANT_SUSPENDED"
      | "EMPTY_CART"
      | "PRODUCT_UNAVAILABLE"
      | "OUT_OF_STOCK"
      | "BELOW_MINIMUM"
      | "COUPON_LIMIT_REACHED"
      | "INVALID_TRANSITION"
      | "ORDER_NOT_FOUND"
      | "LINK_CLOSED"
  ) {
    super(message);
    this.name = "OrderError";
  }
}

