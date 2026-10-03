/**
 * Runs `tick` at a fixed rate regardless of the render frame rate: the
 * simulation must advance in identical steps on client and server, so frame
 * time is banked and spent in whole ticks.
 */
export class FixedStepLoop {
  private accumulator = 0;

  constructor(
    private readonly stepSeconds: number,
    private readonly tick: () => void,
    /** After a long stall (background tab) catch up this many ticks, then drop the rest. */
    private readonly maxTicksPerFrame = 5,
  ) {}

  /** Feed the real elapsed time; returns how many ticks ran. */
  advance(elapsedSeconds: number): number {
    this.accumulator += elapsedSeconds;
    let ran = 0;
    while (this.accumulator >= this.stepSeconds && ran < this.maxTicksPerFrame) {
      this.accumulator -= this.stepSeconds;
      this.tick();
      ran++;
    }
    if (ran === this.maxTicksPerFrame) this.accumulator = 0;
    return ran;
  }

  /** 0..1 progress to the next tick, for smoothing what is drawn between ticks. */
  get alpha(): number {
    return this.accumulator / this.stepSeconds;
  }
}
