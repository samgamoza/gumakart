import { NextResponse } from "next/server";
import { z } from "zod";
import { StaffError } from "@gumakart/db";
import { ApiAuthError } from "@/lib/api-auth";

export function staffFail(error: unknown, label: string) {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof StaffError) {
    const status = error.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Check the details." }, { status: 400 });
  }
  console.error(`[staff ${label}]`, error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}
