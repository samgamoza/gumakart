import { recordAppError } from "./queries/operations";

/**
 * Phase 16 — catch blocks across the apps log unexpected failures with
 * `console.error("[label]", error)`. Wrapping console.error once per process records those
 * Error objects in app_errors too (best effort, never throws, never recurses).
 */
let installed = false;
let inside = false;

export function installConsoleErrorCapture(app: string): void {
  if (installed || typeof console === "undefined") return;
  installed = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    if (inside) return;
    const error = args.find((a): a is Error => a instanceof Error);
    if (!error) return;
    const label = typeof args[0] === "string" ? args[0].slice(0, 120) : null;
    inside = true;
    void recordAppError({ app, route: label, error })
      .catch(() => undefined)
      .finally(() => {
        inside = false;
      });
  };
}
