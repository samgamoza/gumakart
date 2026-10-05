import { installConsoleErrorCapture, recordAppError } from "@gumakart/db";

/** Node-only half of instrumentation.ts (the edge bundle must not import the database). */
export function installErrorCapture(): void {
  installConsoleErrorCapture("web");
}

export async function captureRequestError(error: unknown, route: string): Promise<void> {
  await recordAppError({ app: "web", route, error });
}
