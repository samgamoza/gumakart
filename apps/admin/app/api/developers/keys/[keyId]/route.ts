import { NextResponse } from "next/server";
import { z } from "zod";
import { revokeApiToken } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { devFail } from "@/lib/developer-api";

/** Revoke — takes effect on the next request made with the key. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ keyId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { keyId } = await params;
    z.string().uuid().parse(keyId);
    const row = await revokeApiToken(session.tenantId, keyId);
    await recordActivity(session, { action: "api_key.revoked", entityType: "api_key", entityId: row.id, summary: `Revoked API key "${row.name}"` });
    return NextResponse.json({ ok: true, key: row });
  } catch (error) {
    return devFail(error, "keys revoke");
  }
}
