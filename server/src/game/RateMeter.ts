/**
 * Turns a running total (bytes sent so far) into a per-second rate over a
 * sliding window, so `/metrics` can say "38 KB/s" instead of a lifetime sum.
 */
export class RateMeter {
  private readonly samples: { t: number; total: number }[] = [];

  constructor(private readonly windowMs = 5000) {}

  /** Record the current total at time `nowMs`. */
  mark(total: number, nowMs: number): void {
    this.samples.push({ t: nowMs, total });
    while (this.samples.length > 2 && nowMs - (this.samples[1]?.t ?? nowMs) >= this.windowMs) {
      this.samples.shift();
    }
  }

  /** Average rate per second across the window (0 until two samples exist). */
  get perSecond(): number {
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (!first || !last || last.t <= first.t) return 0;
    return ((last.total - first.total) / (last.t - first.t)) * 1000;
  }
}
