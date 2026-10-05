import { NextResponse } from "next/server";
import { z } from "zod";
import { API_SCOPES, createApiToken, listApiTokens } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { devFail } from "@/lib/developer-api";

export async function GET() {
  try {
    const session = await requireTenantSession();
    return NextResponse.json({ ok: true, keys: await listApiTokens(session.tenantId) });
  } catch (error) {
    return devFail(error, "keys list");
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the key a name.").max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Pick at least one permission."),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]).optional(),
});

/** New key — the full key is in this response only. */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = createSchema.parse(await request.json());
    const { token, row } = await createApiToken({
      tenantId: session.tenantId,
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expiresInDays ?? null,
      createdByName: session.displayName?.trim() || "Owner",
    });
    await recordActivity(session, {
      action: "api_key.created",
      entityType: "api_key",
      entityId: row.id,
      summary: `Created API key "${row.name}" (${row.scopes.join(", ")})`,
    });
    return NextResponse.json({ ok: true, key: row, token });
  } catch (error) {
    return devFail(error, "keys create");
  }
}
