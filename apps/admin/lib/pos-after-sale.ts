import { ensureRegister, getOpenShift, PosError } from "@gumakart/db";
import { ApiAuthError } from "@/lib/api-auth";
import type { PosActor } from "@/lib/pos-auth";

/** Voids and returns move money out of the drawer: managers and owners only. */
export function assertPosManager(actor: PosActor): void {
  if (actor.role !== "owner" && actor.role !== "manager") {
    throw new ApiAuthError("A manager has to do this. Ask them to unlock the register with their PIN.", 403, "POS_MANAGER_ONLY");
  }
}

export async function requireOpenShiftId(tenantId: string): Promise<string> {
  const register = await ensureRegister(tenantId);
  const shift = await getOpenShift(tenantId, register.id);
  if (!shift) throw new PosError("Open a shift first.", "NO_SHIFT");
  return shift.id;
}
