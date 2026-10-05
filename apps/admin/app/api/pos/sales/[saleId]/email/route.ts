import { NextResponse } from "next/server";
import { z } from "zod";
import { getPosReceipt, sendWithLog } from "@gumakart/db";
import { isEmailAddress, posReceiptEmail, sendTransactionalEmail } from "@gumakart/services";
import { posErrorResponse, requirePosActor } from "@/lib/pos-auth";

const bodySchema = z.object({ email: z.string().trim().max(254) });

/** Phase 13: email the receipt to the buyer (one per sale). Free, unlike SMS. */
export async function POST(request: Request, { params }: { params: Promise<{ saleId: string }> }) {
  try {
    const actor = await requirePosActor();
    const { saleId } = await params;
    z.string().uuid().parse(saleId);
    const { email } = bodySchema.parse(await request.json());
    if (!isEmailAddress(email)) return NextResponse.json({ ok: false, error: "Enter an email like juan@gmail.com." }, { status: 400 });
    const receipt = await getPosReceipt(actor.tenantId, saleId);
    if (!receipt) return NextResponse.json({ ok: false, error: "Sale not found." }, { status: 404 });
    const t = receipt.totals;
    const mail = posReceiptEmail({
      shopName: receipt.bir?.tradeName || receipt.shopName,
      orderNumber: receipt.orderNumber,
      invoiceNumber: receipt.invoiceNumber,
      createdAt: receipt.createdAt,
      cashierName: receipt.cashierName,
      items: receipt.items.map((i) => ({ title: i.title, quantity: i.quantity, lineTotal: i.lineTotal })),
      subtotal: t.subtotal,
      discount: t.discountAmount,
      total: t.total,
      vatLine: t.vatAmount > 0 && !t.vatExempt ? `VATable sales ₱${t.netOfVat.toFixed(2)} · VAT ₱${t.vatAmount.toFixed(2)}` : null,
      tenders: receipt.tenders.map((x) => ({ method: x.method, amount: x.amount })),
      change: receipt.change,
      notOfficial: !receipt.bir,
    });
    const result = await sendWithLog(
      {
        tenantId: actor.tenantId,
        orderId: receipt.orderId,
        channel: "email",
        recipient: email,
        recipe: "pos_receipt_email",
        entityId: receipt.orderId,
        body: mail.text,
        provider: "resend",
        kind: "transactional",
      },
      async () => {
        const sent = await sendTransactionalEmail({ to: email, subject: mail.subject, text: mail.text, html: mail.html, tags: [{ name: "recipe", value: "pos_receipt" }] });
        return { success: sent.sent || Boolean(sent.mock), messageId: sent.id, error: sent.error, mock: sent.mock };
      }
    );
    if (result.status === "duplicate") return NextResponse.json({ ok: true, status: "already_sent" });
    if (result.status === "failed") return NextResponse.json({ ok: false, error: "The email didn't go through. Print it instead." }, { status: 502 });
    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    return posErrorResponse(error, "receipt email");
  }
}
