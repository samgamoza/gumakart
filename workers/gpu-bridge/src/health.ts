import type { CircuitBreaker } from "./circuit-breaker";
import type { Logger } from "./logger";

/**
 * While a breaker is open/half-open, probe the node cheaply (ComfyUI /system_stats, vLLM /models)
 * so it closes as soon as the tunnel is back — without risking a real job on the probe.
 */
export async function probe(breaker: CircuitBreaker, ping: () => Promise<void>, log: Logger): Promise<void> {
  if (breaker.currentState === "closed") return;
  if (!breaker.canRequest()) return;
  try {
    await ping();
    breaker.onSuccess();
  } catch (error) {
    breaker.onFailure(error instanceof Error ? error.message : String(error));
    log.debug("gpu node probe failed", { breaker: breaker.name, error });
  }
}
