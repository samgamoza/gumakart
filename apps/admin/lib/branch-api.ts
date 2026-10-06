import { NextResponse } from "next/server";
import { z } from "zod";
import { BranchError } from "@gumakart/db";
import { ApiAuthError } from "@/lib/api-auth";

export function branchFail(error: unknown, label: string): NextResponse {
  if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  if (error instanceof BranchError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
  if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Check the details." }, { status: 400 });
  console.error(`[branches] ${label}`, error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}
