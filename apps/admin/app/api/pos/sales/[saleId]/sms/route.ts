import { NextResponse } from "next/server";
import { z } from "zod";
import { getPosReceipt, normalizePhMobile, sendWithLog } from "@gumakart/db";
import { createSemaphoreClient, posReceiptSms } from "@gumakart/services";
import { posErrorResponse, requirePosActor } from "@/lib/pos-auth";

const bodySchema = z.object({ phone: z.string().max(20) });

/** Text the receipt to the buyer (one per sale). */
export async function POST(request: Request, { params }: { params: Promise<{ saleId: string }> }) {
  try {
    const actor = await requirePosActor();
    const { saleId } = await params;
    z.string().uuid().parse(saleId);
    const body = bodySchema.parse(await request.json());
    const phone = normalizePhMobile(body.phone);
    if (!phone) return NextResponse.json({ ok: false, error: "Enter a PH mobile like 0917 123 4567." }, { status: 400 });
    const receipt = await getPosReceipt(actor.tenantId, saleId);
    if (!receipt) return NextResponse.json({ ok: false, error: "Sale not found." }, { status: 404 });
    const message = posReceiptSms(receipt);
    const sms = createSemaphoreClient();
    const result = await sendWithLog(
      {
        tenantId: actor.tenantId,
        orderId: receipt.orderId,
        channel: "sms",
        recipient: phone,
        recipe: "pos_receipt",
        entityId: receipt.orderId,
        body: message,
        provider: "semaphore",
        kind: "transactional",
      },
      () => sms.send({ to: phone, message })
    );
    if (result.status === "duplicate") return NextResponse.json({ ok: true, status: "already_sent" });
    if (result.status === "failed") return NextResponse.json({ ok: false, error: "The text didn't go through. Print it instead." }, { status: 502 });
    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    return posErrorResponse(error, "receipt sms");
  }
}
