import type { FxLevel } from './PostFx';

/** One step of picture quality: which post-processing, and the most pixels per CSS pixel. */
export interface QualityRung {
  readonly fx: FxLevel;
  readonly maxPixelRatio: number;
}

/**
 * Best first. Effects go before resolution, and resolution in two steps: on
 * a high-DPI laptop screen the full pixel ratio is the costliest thing of
 * all, while 1.5 still looks sharp.
 */
export const QUALITY_LADDER: readonly QualityRung[] = [
  { fx: 'high', maxPixelRatio: 2 },
  { fx: 'fxaa', maxPixelRatio: 2 },
  { fx: 'fxaa', maxPixelRatio: 1.5 },
  { fx: 'off', maxPixelRatio: 1.5 },
  { fx: 'off', maxPixelRatio: 1 },
];

/**
 * Where the game stands on the quality ladder for this screen. Steps that
 * would change nothing here (a resolution step on a screen that is already
 * 1×) are skipped, so every step down actually saves work.
 */
export class QualityLadder {
  private index = 0;

  constructor(
    private readonly devicePixelRatio: number,
    private readonly rungs: readonly QualityRung[] = QUALITY_LADDER,
  ) {}

  get current(): QualityRung {
    return this.rungs[this.index] as QualityRung;
  }

  /** The pixel ratio to render at on this rung. */
  get pixelRatio(): number {
    return Math.max(1, Math.min(this.devicePixelRatio, this.current.maxPixelRatio));
  }

  /** Steps down to the next rung that changes something; false at the bottom. */
  stepDown(): boolean {
    const from = this.current;
    const ratio = this.pixelRatio;
    for (let i = this.index + 1; i < this.rungs.length; i++) {
      this.index = i;
      if (this.current.fx !== from.fx || this.pixelRatio !== ratio) return true;
    }
    return false;
  }
}
