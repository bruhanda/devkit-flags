/**
 * Backoff curve used by the polling + SSE drivers. Doubles on each
 * failure starting from `base`, capped at `cap`.
 */
export interface BackoffStrategy {
  readonly base: number;
  readonly cap: number;
}

/** Compute the delay in ms after `attempt` consecutive failures. */
export function backoffDelay(strategy: BackoffStrategy, attempt: number): number {
  const exponent = Math.min(attempt, 30);
  const candidate = strategy.base * 2 ** exponent;
  return Math.min(candidate, strategy.cap);
}

/**
 * Tiny interval driver — uses `globalThis.setInterval` only, never
 * Node `Timer` types so the source bundle survives `tsup` minification
 * for edge runtimes. Pause-aware: `stop()` clears the timer and
 * resets the backoff on the next `start()`.
 *
 * Internal note: `intervalHandle` and `backoffHandle` are tracked
 * separately because `start()` may be called either from `setInterval`
 * (steady state) or from a `setTimeout` armed by the failure path.
 * Conflating them once led to a silent-source bug: the re-arm closure
 * left `intervalHandle` pointing at an already-fired timeout id, which
 * tripped the early-return guard on the next `start()`.
 */
export class IntervalDriver {
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private backoffHandle: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly tick: () => Promise<void>,
    private readonly strategy: BackoffStrategy,
  ) {}

  start(): void {
    if (this.intervalHandle !== undefined) return;
    const driver = (): void => {
      void this.tick().then(
        () => {
          this.failures = 0;
        },
        () => {
          this.failures += 1;
          this.stop();
          const delay = backoffDelay(this.strategy, this.failures);
          this.backoffHandle = setTimeout(() => {
            this.backoffHandle = undefined;
            this.start();
          }, delay);
        },
      );
    };
    this.intervalHandle = setInterval(driver, this.intervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    if (this.backoffHandle !== undefined) {
      clearTimeout(this.backoffHandle);
      this.backoffHandle = undefined;
    }
  }
}
