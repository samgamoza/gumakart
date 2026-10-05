import { NextResponse } from "next/server";
import { z } from "zod";
import { BirError, OrderError, type GatewayPartialRefund } from "@gumakart/db";
import { createPayMongoClient } from "@gumakart/services";
import { ApiAuthError } from "@/lib/api-auth";

/** PayMongo partial refunds (ready to hook up: the client is a labeled mock until keys are set). */
export const paymongoPartialRefund: GatewayPartialRefund = async (req) => {
  const refund = await createPayMongoClient().createRefund({
    paymentId: req.gatewayPaymentId,
    amountCentavos: req.amountCentavos,
    reason: "requested_by_customer",
    notes: `${req.reason} — order ${req.orderNumber}`.slice(0, 200),
  });
  return { refundId: refund.id };
};

export function afterSaleFail(error: unknown, label: string) {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof OrderError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.code === "ORDER_NOT_FOUND" ? 404 : 400 });
  }
  if (error instanceof BirError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Check the details." }, { status: 400 });
  }
  console.error(`[${label}]`, error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}
