/** Rolling frame-time statistics for the fps overlay and perf checks (rules.md §4). */
export class FrameStats {
  private readonly samples: number[] = [];

  constructor(private readonly windowSize = 120) {}

  push(frameMs: number): void {
    this.samples.push(frameMs);
    if (this.samples.length > this.windowSize) this.samples.shift();
  }

  get fps(): number {
    if (this.samples.length === 0) return 0;
    const mean = this.samples.reduce((sum, ms) => sum + ms, 0) / this.samples.length;
    return mean > 0 ? 1000 / mean : 0;
  }

  /** Slowest frame in the window, ms: spikes hurt more than the average. */
  get worstMs(): number {
    return this.samples.length === 0 ? 0 : Math.max(...this.samples);
  }
}
