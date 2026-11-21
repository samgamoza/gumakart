import { NextResponse } from "next/server";
import { z } from "zod";
import { getActivePrintairCard, setPrintairCardStatus } from "@gumakart/db";
import { ApiAuthError, assertCan, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { buildPrintairHandoff } from "@/lib/ai-suite-growth";

/** AI suite Phase 5.2: the dismissible "Branded packaging" card on the dashboard. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    return NextResponse.json({ ok: true, card: await getActivePrintairCard(session.tenantId) });
  } catch (error) {
    return fail(error);
  }
}

/** dismiss, or "Order on Printair" → a signed 5-minute handoff URL. */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    assertCan(session, "billing.manage");
    const body = z.object({ action: z.enum(["dismiss", "handoff"]), id: z.string().uuid() }).parse(await request.json());
    const card = await getActivePrintairCard(session.tenantId);
    if (!card || card.id !== body.id) return NextResponse.json({ ok: false, error: "This offer is no longer available." }, { status: 404 });
    if (body.action === "dismiss") {
      await setPrintairCardStatus(session.tenantId, card.id, "dismiss");
      return NextResponse.json({ ok: true });
    }
    const handoff = await buildPrintairHandoff(session.tenantId, card, { email: session.email ?? null, name: session.displayName ?? null });
    if (!handoff.ok) return NextResponse.json({ ok: false, error: handoff.error }, { status: 503 });
    await setPrintairCardStatus(session.tenantId, card.id, "handoff");
    await recordActivity(session, { action: "printair.handoff", entityType: "printair_upsell", entityId: card.id, summary: "Opened branded packaging on Printair" });
    return NextResponse.json({ ok: true, url: handoff.url, expiresAt: handoff.expiresAt });
  } catch (error) {
    return fail(error);
  }
}

function fail(error: unknown) {
  if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  console.error("[printair]", error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}
