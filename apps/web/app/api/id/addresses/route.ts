import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteBuyerAddress, saveBuyerAddress } from "@gumakart/db";
import { idFail, requireBuyer } from "@/lib/guma-id";

const addressSchema = z.object({
  line1: z.string().max(200),
  regionCode: z.string().max(20).optional(),
  region: z.string().max(80).optional(),
  provinceCode: z.string().max(20).optional(),
  province: z.string().max(80).optional(),
  cityCode: z.string().max(20).optional(),
  city: z.string().max(80).optional(),
  barangay: z.string().max(80).optional(),
  landmark: z.string().max(120).optional(),
});

const saveSchema = z.object({
  id: z.string().uuid().nullish(),
  label: z.string().max(40).nullish(),
  recipient: z.string().max(120).nullish(),
  address: addressSchema,
  makeDefault: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const buyer = await requireBuyer();
    const body = saveSchema.parse(await request.json());
    return NextResponse.json({ ok: true, addresses: await saveBuyerAddress(buyer.id, body) });
  } catch (error) {
    return idFail(error, "address save");
  }
}

export async function DELETE(request: Request) {
  try {
    const buyer = await requireBuyer();
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    return NextResponse.json({ ok: true, addresses: await deleteBuyerAddress(buyer.id, id) });
  } catch (error) {
    return idFail(error, "address delete");
  }
}
