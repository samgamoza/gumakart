/**
 * Circuit breaker for the home GPU node (reached over a Cloudflare Tunnel that can drop when the
 * workstation sleeps, reboots or loses internet).
 *
 *   closed     → requests flow; `failureThreshold` consecutive failures open it.
 *   open       → requests are refused (jobs are parked, not failed) for `cooldownMs`.
 *   half_open  → one probe request is let through; success closes, failure re-opens.
 */
export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerOptions {
  name: string;
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
  onStateChange?: (name: string, from: BreakerState, to: BreakerState, reason: string) => void;
}

export class CircuitBreaker {
  readonly name: string;
  private state: BreakerState = "closed";
  private failures = 0;
  private openedAt = 0;
  private probeInFlight = false;
  private readonly now: () => number;

  constructor(private readonly opts: BreakerOptions) {
    this.name = opts.name;
    this.now = opts.now ?? Date.now;
  }

  get currentState(): BreakerState {
    if (this.state === "open" && this.now() - this.openedAt >= this.opts.cooldownMs) {
      this.transition("half_open", "cooldown elapsed");
    }
    return this.state;
  }

  /** ms until an open breaker will allow a probe (0 when not open). */
  get retryInMs(): number {
    if (this.currentState !== "open") return 0;
    return Math.max(this.opts.cooldownMs - (this.now() - this.openedAt), 0);
  }

  /** May a request go out now? In half_open only one probe at a time is allowed. */
  canRequest(): boolean {
    const s = this.currentState;
    if (s === "closed") return true;
    if (s === "half_open" && !this.probeInFlight) {
      this.probeInFlight = true;
      return true;
    }
    return false;
  }

  onSuccess(): void {
    this.failures = 0;
    this.probeInFlight = false;
    if (this.state !== "closed") this.transition("closed", "request succeeded");
  }

  onFailure(reason = "request failed"): void {
    this.probeInFlight = false;
    this.failures += 1;
    if (this.state === "half_open" || (this.state === "closed" && this.failures >= this.opts.failureThreshold)) {
      this.openedAt = this.now();
      this.transition("open", reason);
    }
  }

  /** Run `fn` through the breaker. Throws GpuNodeUnavailableError without calling fn when open. */
  async run<T>(fn: () => Promise<T>, isNodeFailure: (e: unknown) => boolean = () => true): Promise<T> {
    if (!this.canRequest()) throw new GpuNodeUnavailableError(this.name, this.retryInMs);
    try {
      const out = await fn();
      this.onSuccess();
      return out;
    } catch (error) {
      if (isNodeFailure(error)) this.onFailure(error instanceof Error ? error.message : String(error));
      else this.onSuccess(); // node answered; the request itself was bad
      throw error;
    }
  }

  private transition(to: BreakerState, reason: string) {
    const from = this.state;
    this.state = to;
    if (to === "closed") this.failures = 0;
    if (from !== to) this.opts.onStateChange?.(this.name, from, to, reason);
  }
}

export class GpuNodeUnavailableError extends Error {
  constructor(readonly breaker: string, readonly retryInMs: number) {
    super(`GPU node unavailable (${breaker} circuit open, retry in ${Math.ceil(retryInMs / 1000)}s)`);
    this.name = "GpuNodeUnavailableError";
  }
}

/** Errors that mean "the node/tunnel is down" rather than "this request was wrong". */
export function isNodeFailure(error: unknown): boolean {
  if (error instanceof HttpError) return error.status >= 500 || error.status === 408 || error.status === 429;
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return true;
    // undici fetch network errors surface as TypeError("fetch failed") with a cause
    if (error.name === "TypeError" && /fetch failed|network/i.test(error.message)) return true;
    if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(error.message + String((error as { cause?: unknown }).cause ?? ""))) return true;
  }
  return false;
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly url: string, readonly body: string) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 300)}`);
    this.name = "HttpError";
  }
}
