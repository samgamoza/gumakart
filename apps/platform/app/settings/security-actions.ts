"use server";

import { AuthError, getTwoFactorStatus, regenerateBackupCodes, revokeAllSessions } from "@gumakart/auth";
import { writeAudit } from "@gumakart/db";
import { requireSuperAdminApi } from "@/lib/api-auth";

/** Phase 21: new backup codes for the signed-in ops admin (needs a current code). */
export async function regenerateOpsBackupCodesAction(code: string): Promise<{ ok: true; backupCodes: string[] } | { ok: false; error: string }> {
  const session = await requireSuperAdminApi();
  try {
    const { backupCodes } = await regenerateBackupCodes(session.userId, String(code ?? ""));
    await writeAudit({ actorId: session.userId, actorEmail: session.email, action: "ops_2fa_backup_codes_regenerated", entityType: "user", entityId: session.userId, entityLabel: session.email });
    return { ok: true, backupCodes };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Signs this admin out on every device (including this one). */
export async function signOutEverywhereAction(): Promise<{ ok: true }> {
  const session = await requireSuperAdminApi();
  await revokeAllSessions(session.userId);
  await writeAudit({ actorId: session.userId, actorEmail: session.email, action: "ops_signed_out_everywhere", entityType: "user", entityId: session.userId, entityLabel: session.email });
  return { ok: true };
}

export async function opsSecurityStatusAction() {
  const session = await requireSuperAdminApi();
  const s = await getTwoFactorStatus(session.userId);
  return { enabled: s.enabled, enabledAt: s.enabledAt?.toISOString() ?? null, backupCodesLeft: s.backupCodesLeft };
}
