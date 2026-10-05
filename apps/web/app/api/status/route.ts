import { NextResponse } from "next/server";
import { getPublicStatus } from "@gumakart/db";

export const dynamic = "force-dynamic";

/** Public JSON for the status page (for uptime monitors). No internal alert details. */
export async function GET() {
  try {
    const s = await getPublicStatus();
    return NextResponse.json(
      {
        overall: s.overall,
        components: s.components,
        incidents: s.active.map((i) => ({ id: i.id, title: i.title, impact: i.impact, status: i.status, components: i.components, created_at: i.createdAt, updates: i.updates })),
        updated_at: s.updatedAt,
      },
      { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" } }
    );
  } catch {
    return NextResponse.json({ overall: "major_outage", components: [], incidents: [], error: "database unreachable" }, { status: 503 });
  }
}
