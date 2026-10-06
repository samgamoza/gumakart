import { z } from "zod";
import { AuthError, verifySecondFactor } from "@gumakart/auth";
import { codeAttemptsLeft, currentOpsTicket, jsonError, opsSessionResponse } from "@/lib/ops-sign-in";

const schema = z.object({ code: z.string().trim().min(6).max(20) });

/** Ops sign-in, step 2: authenticator code or a backup code → session. */
export async function POST(request: Request) {
  try {
    const ticket = await currentOpsTicket(request);
    if (!ticket || ticket.kind !== "verify") return jsonError("Your sign-in expired. Enter your password again.", 401);
    const wait = await codeAttemptsLeft(request, ticket.userId);
    if (wait !== null) return jsonError("Too many tries. Wait a few minutes, then sign in again.", 429, { "Retry-After": String(wait) });
    const { code } = schema.parse(await request.json());
    const result = await verifySecondFactor(ticket.userId, code);
    return opsSessionResponse(
      ticket.userId,
      { backupCodesLeft: result.method === "backup" ? result.backupCodesLeft : undefined },
      { action: result.method === "backup" ? "ops_sign_in_backup_code" : "ops_sign_in", metadata: { method: result.method } }
    );
  } catch (error) {
    if (error instanceof AuthError) return jsonError(error.message, 400);
    if (error instanceof z.ZodError) return jsonError("Enter the 6-digit code from your app, or a backup code.", 400);
    console.error("[platform/auth/2fa/verify]", error);
    return jsonError("Something went wrong.", 500);
  }
}
