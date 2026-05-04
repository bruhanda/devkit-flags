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
 */
export class IntervalDriver {
  private handle: ReturnType<typeof setInterval> | undefined;
  private failures = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly tick: () => Promise<void>,
    private readonly strategy: BackoffStrategy,
  ) {}

  start(): void {
    if (this.handle !== undefined) return;
    const driver = (): void => {
      void this.tick().then(
        () => {
          this.failures = 0;
        },
        () => {
          this.failures += 1;
          // Reschedule with backoff
          this.stop();
          const delay = backoffDelay(this.strategy, this.failures);
          this.handle = setTimeout(() => {
            this.start();
          }, delay);
        },
      );
    };
    this.handle = setInterval(driver, this.intervalMs);
  }

  stop(): void {
    if (this.handle !== undefined) {
      clearInterval(this.handle as unknown as ReturnType<typeof setInterval>);
      clearTimeout(this.handle as unknown as ReturnType<typeof setTimeout>);
      this.handle = undefined;
    }
  }
}
