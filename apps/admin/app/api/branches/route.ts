import { NextResponse } from "next/server";
import { z } from "zod";
import { createBranch, listBranches } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { branchFail } from "@/lib/branch-api";

export async function GET() {
  try {
    const session = await requireTenantSession();
    return NextResponse.json({ ok: true, ...(await listBranches(session.tenantId)) });
  } catch (error) {
    return branchFail(error, "list");
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Give the branch a name.").max(120),
  addressLine: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = createSchema.parse(await request.json());
    const branch = await createBranch(session.tenantId, body);
    await recordActivity(session, { action: "branch.created", entityType: "location", entityId: branch.id, summary: `Added branch "${branch.name}"` });
    return NextResponse.json({ ok: true, branch });
  } catch (error) {
    return branchFail(error, "create");
  }
}
