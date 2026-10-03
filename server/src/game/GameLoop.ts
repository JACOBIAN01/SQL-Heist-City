/** Time and timers, injected so loop tests run instantly and deterministically. */
export interface Scheduler {
  now(): number;
  after(ms: number, callback: () => void): () => void;
}

export const systemScheduler: Scheduler = {
  now: () => performance.now(),
  after: (ms, callback) => {
    const handle = setTimeout(callback, ms);
    return () => clearTimeout(handle);
  },
};

/** Tick durations (ms) over a sliding window, for the "<15 ms at 100 players" budget (backend.md). */
export class TickStats {
  private readonly samples: number[] = [];

  constructor(private readonly windowSize = 200) {}

  record(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > this.windowSize) this.samples.shift();
  }

  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
  }

  get max(): number {
    return this.samples.length === 0 ? 0 : Math.max(...this.samples);
  }

  get count(): number {
    return this.samples.length;
  }
}

/**
 * Calls `step` at a fixed rate with drift correction: each tick is scheduled
 * against the ideal timeline, not "50 ms after the last one finished", so a slow
 * tick does not permanently slow the game. Falls behind gracefully: after a
 * long stall it skips ahead instead of firing a burst of catch-up ticks.
 */
export class GameLoop {
  readonly stats = new TickStats();
  private cancel: (() => void) | undefined;
  private nextAt = 0;
  private running = false;

  constructor(
    private readonly tickMs: number,
    private readonly step: () => void,
    private readonly scheduler: Scheduler = systemScheduler,
    /** After falling this many ticks behind, resync instead of catching up. */
    private readonly maxLagTicks = 5,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.nextAt = this.scheduler.now() + this.tickMs;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.cancel?.();
    this.cancel = undefined;
  }

  private schedule(): void {
    const delay = Math.max(0, this.nextAt - this.scheduler.now());
    this.cancel = this.scheduler.after(delay, () => {
      if (!this.running) return;
      const started = this.scheduler.now();
      this.step();
      const finished = this.scheduler.now();
      this.stats.record(finished - started);
      this.nextAt += this.tickMs;
      if (finished - this.nextAt > this.tickMs * this.maxLagTicks)
        this.nextAt = finished + this.tickMs;
      this.schedule();
    });
  }
}
