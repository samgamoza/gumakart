/**
 * Phase 16 — every uncaught server error (route handlers, server components, actions) and
 * every Error logged with console.error is grouped into app_errors and shows in
 * ops.guma.one → System health. Node runtime only; never throws.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Security G1 (GK-2): rate limits count in the shared database table instead of
    // per-isolate memory, so every Worker copy enforces the same limit.
    try {
      const [{ registerSharedRateLimitBackend }, { dbRateLimitHit }] = await Promise.all([
        import("@gumakart/services"),
        import("@gumakart/db"),
      ]);
      registerSharedRateLimitBackend(dbRateLimitHit);
    } catch {
      /* falls back to the in-memory window */
    }
    try {
      const { installErrorCapture } = await import("./instrumentation-node");
      installErrorCapture();
    } catch {
      /* optional */
    }
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string }
): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { captureRequestError } = await import("./instrumentation-node");
      await captureRequestError(error, `${request.method} ${context.routePath || request.path.split("?")[0]}`);
    } catch {
      /* reporting must never cause a second failure */
    }
  }
}
