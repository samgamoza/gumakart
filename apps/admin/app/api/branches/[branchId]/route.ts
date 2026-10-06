import { NextResponse } from "next/server";
import { z } from "zod";
import { updateBranch } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { branchFail } from "@/lib/branch-api";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  addressLine: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  isActive: z.boolean().optional(),
  makeDefault: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ branchId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { branchId } = await params;
    z.string().uuid().parse(branchId);
    const body = patchSchema.parse(await request.json());
    await updateBranch(session.tenantId, branchId, body);
    const what = body.makeDefault ? "Made main branch" : body.isActive === false ? "Turned off branch" : body.isActive ? "Turned on branch" : "Updated branch";
    await recordActivity(session, { action: "branch.updated", entityType: "location", entityId: branchId, summary: `${what}${body.name ? ` "${body.name}"` : ""}` });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return branchFail(error, "update");
  }
}
