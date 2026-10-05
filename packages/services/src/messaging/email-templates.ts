/**
 * Phase 13 — buyer emails alongside SMS (order received, paid, shipped, out for delivery,
 * delivered) and the POS e-receipt. Plain functions → { subject, text, html }, like the SMS
 * recipes. Taglish for buyers. Inline styles only (email clients), no remote images.
 *
 * Sent through sendTransactionalEmail (Resend). Without RESEND_API_KEY production sends
 * nothing (fail-closed); local dev logs a labeled mock.
 */

export type BuyerEmailKind = "order_created" | "payment_confirmed" | "shipped" | "out_for_delivery" | "delivered";

export interface EmailLine {
  title: string;
  quantity: number;
  lineTotal: number;
}

export interface OrderEmailContext {
  shopName: string;
  orderNumber: string;
  buyerName?: string | null;
  items: EmailLine[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  paymentMethod: string;
  deliveryType: string;
  orderUrl: string;
  /** Pickup orders: where to pick up. */
  pickupAddress?: string | null;
  courier?: string | null;
  codDue?: boolean;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function emailPeso(n: number): string {
  return `₱${(Math.round(n * 100) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function escapeEmailHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const METHOD: Record<string, string> = {
  cod: "Cash on delivery",
  gcash: "GCash",
  maya: "Maya",
  card: "Card",
  bank_transfer: "Bank transfer",
  cash: "Cash",
  paymongo: "Online payment",
};

export function paymentLabel(method: string): string {
  return METHOD[method] ?? method.replace(/_/g, " ");
}

function headline(kind: BuyerEmailKind, ctx: OrderEmailContext): { subject: string; title: string; intro: string } {
  const hi = ctx.buyerName?.trim() ? `Hi ${ctx.buyerName.trim().split(/\s+/)[0]}! ` : "Hi! ";
  const pickup = ctx.deliveryType === "pickup";
  switch (kind) {
    case "order_created":
      return {
        subject: `Order ${ctx.orderNumber} received — ${ctx.shopName}`,
        title: "Salamat sa order mo!",
        intro: `${hi}Natanggap ng ${ctx.shopName} ang order mo. ${
          ctx.paymentMethod === "cod"
            ? "Bayad pagdating (COD)."
            : "Kung hindi pa bayad, buksan ang order para sa payment details."
        }`,
      };
    case "payment_confirmed":
      return {
        subject: `Payment confirmed — order ${ctx.orderNumber}`,
        title: "Bayad na, salamat!",
        intro: `${hi}Na-confirm ng ${ctx.shopName} ang bayad mo. Ihahanda na nila ang order.`,
      };
    case "shipped":
      return pickup
        ? {
            subject: `Ready for pickup — order ${ctx.orderNumber}`,
            title: "Ready na for pickup!",
            intro: `${hi}Pwede mo nang kunin ang order mo${ctx.pickupAddress ? ` sa ${ctx.pickupAddress}` : ""}.${ctx.codDue ? ` Dalhin ang ${emailPeso(ctx.total)}.` : ""}`,
          }
        : {
            subject: `Rider booked — order ${ctx.orderNumber}`,
            title: "May rider na!",
            intro: `${hi}Naka-book na ang rider${ctx.courier ? ` (${ctx.courier})` : ""} para sa order mo.`,
          };
    case "out_for_delivery":
      return {
        subject: `On the way — order ${ctx.orderNumber}`,
        title: "Papunta na sa'yo!",
        intro: `${hi}Nasa rider na ang order mo.${ctx.codDue ? ` Ihanda ang ${emailPeso(ctx.total)} (COD).` : ""}`,
      };
    case "delivered":
      return {
        subject: `Delivered — order ${ctx.orderNumber}`,
        title: pickup ? "Nakuha mo na!" : "Na-deliver na!",
        intro: `${hi}Salamat sa pagbili sa ${ctx.shopName}. Sana magustuhan mo!`,
      };
  }
}

function itemsTable(items: EmailLine[], rows: Array<[string, string, boolean?]>): string {
  const lines = items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;color:#1f2937">${escapeEmailHtml(i.title)} <span style="color:#6b7280">× ${i.quantity}</span></td>` +
        `<td style="padding:6px 0;text-align:right;color:#1f2937;white-space:nowrap">${emailPeso(i.lineTotal)}</td></tr>`
    )
    .join("");
  const totals = rows
    .map(
      ([label, value, bold]) =>
        `<tr><td style="padding:4px 0;color:${bold ? "#111827" : "#6b7280"};${bold ? "font-weight:700;font-size:16px" : ""}">${escapeEmailHtml(label)}</td>` +
        `<td style="padding:4px 0;text-align:right;color:#111827;${bold ? "font-weight:700;font-size:16px" : ""}">${escapeEmailHtml(value)}</td></tr>`
    )
    .join("");
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">${lines}` +
    `<tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:4px"></td></tr>${totals}</table>`
  );
}

function shell(input: { shopName: string; title: string; intro: string; body: string; button?: { label: string; url: string }; footer: string }): string {
  const button = input.button
    ? `<p style="margin:24px 0"><a href="${escapeEmailHtml(input.button.url)}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escapeEmailHtml(input.button.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:28px">
<tr><td>
<p style="margin:0 0 4px;font-size:13px;color:#7c3aed;font-weight:600">${escapeEmailHtml(input.shopName)}</p>
<h1 style="margin:0 0 12px;font-size:22px;color:#111827">${escapeEmailHtml(input.title)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#374151">${escapeEmailHtml(input.intro)}</p>
${input.body}
${button}
<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;line-height:1.5">${escapeEmailHtml(input.footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function totalsRows(ctx: { subtotal: number; deliveryFee: number; discount: number; total: number }): Array<[string, string, boolean?]> {
  const rows: Array<[string, string, boolean?]> = [["Subtotal", emailPeso(ctx.subtotal)]];
  if (ctx.discount > 0) rows.push(["Discount", `-${emailPeso(ctx.discount)}`]);
  if (ctx.deliveryFee > 0) rows.push(["Delivery", emailPeso(ctx.deliveryFee)]);
  rows.push(["Total", emailPeso(ctx.total), true]);
  return rows;
}

/** Buyer order emails (mirror the SMS recipes, with the full item list). */
export function orderEmail(kind: BuyerEmailKind, ctx: OrderEmailContext): RenderedEmail {
  const h = headline(kind, ctx);
  const rows = totalsRows(ctx);
  const payLine = `Bayad: ${paymentLabel(ctx.paymentMethod)}${ctx.codDue ? " (babayaran pagdating)" : ""}`;
  const text = [
    h.title,
    "",
    h.intro,
    "",
    `Order ${ctx.orderNumber}`,
    ...ctx.items.map((i) => `- ${i.title} x${i.quantity}  ${emailPeso(i.lineTotal)}`),
    ...rows.map(([l, v]) => `${l}: ${v}`),
    payLine,
    "",
    `Tingnan ang order: ${ctx.orderUrl}`,
    "",
    `Galing ito sa ${ctx.shopName} sa pamamagitan ng Guma Kart. Mag-reply para makausap ang shop.`,
  ].join("\n");
  const html = shell({
    shopName: ctx.shopName,
    title: h.title,
    intro: h.intro,
    body: `<p style="margin:0 0 8px;font-size:13px;color:#6b7280">Order <strong style="color:#111827">${escapeEmailHtml(ctx.orderNumber)}</strong></p>${itemsTable(ctx.items, rows)}<p style="margin:12px 0 0;font-size:13px;color:#6b7280">${escapeEmailHtml(payLine)}</p>`,
    button: { label: "Tingnan ang order", url: ctx.orderUrl },
    footer: `Galing ito sa ${ctx.shopName} sa pamamagitan ng Guma Kart. Mag-reply para makausap ang shop.`,
  });
  return { subject: h.subject, text, html };
}

export interface PosEmailContext {
  shopName: string;
  orderNumber: string;
  invoiceNumber?: string | null;
  createdAt: Date | string;
  cashierName: string;
  items: EmailLine[];
  subtotal: number;
  discount: number;
  total: number;
  vatLine?: string | null;
  tenders: Array<{ method: string; amount: number }>;
  change: number;
  /** BIR off: "This is not an official receipt." */
  notOfficial: boolean;
}

/** E-receipt for a sale at the counter (buyer gave an email at the register). */
export function posReceiptEmail(r: PosEmailContext): RenderedEmail {
  const when = new Date(r.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
  const rows: Array<[string, string, boolean?]> = [["Subtotal", emailPeso(r.subtotal)]];
  if (r.discount > 0) rows.push(["Discount", `-${emailPeso(r.discount)}`]);
  rows.push(["Total", emailPeso(r.total), true]);
  for (const t of r.tenders) rows.push([paymentLabel(t.method), emailPeso(t.amount)]);
  if (r.change > 0) rows.push(["Change", emailPeso(r.change)]);
  const ref = r.invoiceNumber ? `Sales invoice ${r.invoiceNumber} · sale ${r.orderNumber}` : `Sale ${r.orderNumber}`;
  const note = r.notOfficial ? "This is not an official receipt." : "Keep this e-receipt for your records.";
  const text = [
    `Receipt — ${r.shopName}`,
    ref,
    when,
    `Cashier: ${r.cashierName}`,
    "",
    ...r.items.map((i) => `- ${i.title} x${i.quantity}  ${emailPeso(i.lineTotal)}`),
    ...rows.map(([l, v]) => `${l}: ${v}`),
    ...(r.vatLine ? [r.vatLine] : []),
    "",
    "Salamat po!",
    note,
  ].join("\n");
  const html = shell({
    shopName: r.shopName,
    title: "Salamat po!",
    intro: `Ito ang resibo mo mula sa ${r.shopName}.`,
    body:
      `<p style="margin:0 0 8px;font-size:13px;color:#6b7280">${escapeEmailHtml(ref)}<br>${escapeEmailHtml(when)} · Cashier: ${escapeEmailHtml(r.cashierName)}</p>` +
      itemsTable(r.items, rows) +
      (r.vatLine ? `<p style="margin:8px 0 0;font-size:12px;color:#6b7280">${escapeEmailHtml(r.vatLine)}</p>` : ""),
    footer: `${note} Sent by ${r.shopName} via Guma Kart.`,
  });
  return { subject: `Your receipt from ${r.shopName} (${r.orderNumber})`, text, html };
}

export function isEmailAddress(value: string | null | undefined): value is string {
  return Boolean(value && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()));
}
