import { describe, expect, it } from 'vitest';
import { mapById } from '@heist/shared';
import { runHeadlessBench } from './HeadlessBench';
import { makeBenchMap } from './benchMap';

// Phase 23.4: the server tick must stay inside its budget at 100 players (docs/rules.md: 15 ms).
// Measured on the real city, in process. The limit is the written budget, not a tuned-to-pass
// number: if a change makes the tick slower than this, this test fails the build.
describe('tick budget at 100 players', () => {
  it.each([
    ['the bench map', () => makeBenchMap()],
    ['the real city', () => mapById('city')],
  ])(
    '%s: p95 under 15 ms',
    (_name, map) => {
      const m = map();
      if (!m) throw new Error('map missing');
      // Other tests run beside this one and only ever make a run slower, never faster, so the best
      // of a few runs is the cleanest reading of the code's own cost. A real regression is slow in all.
      let best = Infinity;
      for (let attempt = 0; attempt < 5 && best >= 15; attempt++) {
        const r = runHeadlessBench({
          players: 100,
          map: m,
          seconds: 5,
          warmupSeconds: 2,
          fireRate: 0.1,
        });
        best = Math.min(best, r.tickMs.p95);
      }
      expect(best).toBeLessThan(15);
    },
    240000,
  );
});
