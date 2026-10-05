import { NextResponse } from "next/server";
import { exportBuyerData } from "@gumakart/db";
import { idFail, requireBuyer } from "@/lib/guma-id";

/** Download everything Guma holds about me (JSON). */
export async function GET() {
  try {
    const buyer = await requireBuyer();
    const data = await exportBuyerData(buyer.id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="guma-id-${buyer.phone.slice(-4)}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return idFail(error, "export");
  }
}
