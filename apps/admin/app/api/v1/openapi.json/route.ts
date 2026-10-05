import { NextResponse } from "next/server";
import { openApiDocument } from "@/lib/openapi";

/** Public: the API description (no key needed). */
export async function GET(request: Request) {
  const origin = process.env.NODE_ENV === "production" ? "https://admin.guma.one" : new URL(request.url).origin;
  return NextResponse.json(openApiDocument(origin), { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}
