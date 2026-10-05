import { recordAppError } from "@gumakart/db";

/**
 * Phase 16 — record a server error for System health (ops.guma.one). Never throws.
 * Uncaught errors are captured by instrumentation.ts; call this from catch blocks that turn
 * an unexpected error into a 500.
 */
export async function captureError(route: string, error: unknown, app = "admin"): Promise<void> {
  await recordAppError({ app, route, error });
}
