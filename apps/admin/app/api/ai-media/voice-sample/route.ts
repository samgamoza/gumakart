import { NextResponse } from "next/server";
import { getMerchantEntitlements } from "@gumakart/db";
import { ApiAuthError, assertCan, requireTenantSession } from "@/lib/api-auth";
import { denialResponse } from "@/lib/marketing-studio";
import { saveVoiceSample } from "@/lib/product-uploads";

/** Enterprise Vibe: upload the ~10-second recording used for the custom cloned voice. */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    assertCan(session, "marketing.manage");
    const ent = await getMerchantEntitlements(session.tenantId);
    if (!ent?.voiceCloneEnabled) return denialResponse("voice_clone_not_included");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Choose a recording." }, { status: 400 });
    const saved = await saveVoiceSample(session.tenantId, file);
    return NextResponse.json({ ok: true, url: saved.url });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof Error && /recording|WAV|MB/.test(error.message)) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    console.error("[ai-media/voice-sample]", error);
    return NextResponse.json({ ok: false, error: "Upload failed." }, { status: 500 });
  }
}
