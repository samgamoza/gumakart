import { NextResponse } from "next/server";
import { z } from "zod";
import { listPartnerShops, updatePartnerProfile } from "@gumakart/db";
import { requirePartner } from "@/lib/partner-auth";
import { partnerFail } from "@/lib/partner-api";

export async function GET() {
  try {
    const me = await requirePartner();
    const shops = await listPartnerShops(me.partner.id);
    return NextResponse.json({ ok: true, me: { displayName: me.displayName, email: me.email }, partner: me.partner, shops });
  } catch (error) {
    return partnerFail(error, "me");
  }
}

const patchSchema = z.object({
  name: z.string().max(120).optional(),
  phone: z.string().max(20).nullish(),
  website: z.string().max(255).nullish(),
  city: z.string().max(120).nullish(),
  about: z.string().max(500).nullish(),
});

export async function PATCH(request: Request) {
  try {
    const me = await requirePartner();
    const partner = await updatePartnerProfile(me.userId, patchSchema.parse(await request.json()));
    return NextResponse.json({ ok: true, partner });
  } catch (error) {
    return partnerFail(error, "update");
  }
}
