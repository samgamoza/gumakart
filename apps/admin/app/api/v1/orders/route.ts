import { NextResponse } from "next/server";
import {
  FULFILLMENT_STATES,
  ORDER_STATES,
  PAYMENT_STATES,
  SALES_CHANNELS,
  apiListOrders,
  clampLimit,
  decodeCursor,
} from "@gumakart/db";
import { apiError, dateParam, enumParam, withApi } from "@/lib/public-api";

/**
 * GET /api/v1/orders — newest first.
 * Filters: order_state, payment_state, fulfillment_state, channel, created_after, created_before.
 * Paging: limit (1–100, default 50) and cursor (next_cursor from the previous page).
 */
export async function GET(request: Request) {
  return withApi(request, "orders:read", async (p) => {
    const url = new URL(request.url);
    const rawCursor = url.searchParams.get("cursor");
    const cursor = decodeCursor(rawCursor);
    if (rawCursor && !cursor) return apiError(400, "invalid_request", "cursor is not valid. Use next_cursor from the previous page.");
    const page = await apiListOrders(p.tenantId, {
      limit: clampLimit(url.searchParams.get("limit")),
      cursor,
      orderState: enumParam(url, "order_state", ORDER_STATES),
      paymentState: enumParam(url, "payment_state", PAYMENT_STATES),
      fulfillmentState: enumParam(url, "fulfillment_state", FULFILLMENT_STATES),
      channel: enumParam(url, "channel", SALES_CHANNELS),
      createdAfter: dateParam(url, "created_after"),
      createdBefore: dateParam(url, "created_before"),
    });
    return NextResponse.json(page);
  });
}
