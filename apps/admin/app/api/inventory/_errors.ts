import { NextResponse } from "next/server";
import { z } from "zod";
import { InventoryError } from "@gumakart/db";
import { ApiAuthError } from "@/lib/api-auth";

export function inventoryFail(error: unknown, label: string) {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof InventoryError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Check the values." }, { status: 400 });
  }
  console.error(`[inventory ${label}]`, error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}
