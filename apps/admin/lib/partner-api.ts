import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@gumakart/auth";
import { PartnerError } from "@gumakart/db";
import { ApiAuthError } from "@/lib/api-auth";

export function partnerFail(error: unknown, label: string): NextResponse {
  if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  if (error instanceof PartnerError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : error.code === "TAKEN" ? 409 : 400;
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status });
  }
  if (error instanceof AuthError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 400 });
  if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Check the details." }, { status: 400 });
  console.error(`[partners] ${label}`, error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}
