import { logActivity, type ActivityInput } from "@gumakart/db";

/**
 * Phase 10: record who did what. Never throws — logging must not undo or fail
 * the action it describes.
 */
export async function recordActivity(
  session: { tenantId: string; userId: string; displayName?: string | null; shopRole?: string | null; supportAccess?: boolean },
  input: ActivityInput
): Promise<void> {
  const name = session.supportAccess
    ? `Guma support (${session.displayName ?? "ops"})`
    : session.displayName?.trim() || "Someone";
  await logActivity(
    session.tenantId,
    { userId: session.supportAccess ? null : session.userId, name, role: session.supportAccess ? "support" : session.shopRole ?? null },
    input
  );
}

export const peso = (n: number | string) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, "")}`;
