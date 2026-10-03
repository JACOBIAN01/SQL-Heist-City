/**
 * Estimates the server's clock from snapshot ticks so remote players can be
 * drawn at "server time minus a little" (the interpolation delay).
 *
 * Each snapshot gives one sample of (server time − local time). Network delay
 * only ever makes that smaller, so the largest recent sample is the best
 * estimate of the true offset (it is the least-delayed packet).
 */
export class SnapshotClock {
  private readonly samples: number[] = [];

  constructor(private readonly windowSize = 100) {}

  get ready(): boolean {
    return this.samples.length > 0;
  }

  observe(tick: number, tickRate: number, localNowMs: number): void {
    this.samples.push((tick * 1000) / tickRate - localNowMs);
    if (this.samples.length > this.windowSize) this.samples.shift();
  }

  /** Server time (ms) corresponding to a local timestamp. */
  serverTimeAt(localNowMs: number): number {
    return localNowMs + Math.max(...this.samples);
  }
}
