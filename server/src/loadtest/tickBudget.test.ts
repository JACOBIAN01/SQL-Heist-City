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
      const r = runHeadlessBench({
        players: 100,
        map: m,
        seconds: 6,
        warmupSeconds: 2,
        fireRate: 0.1,
      });
      expect(r.tickMs.p95).toBeLessThan(15);
    },
    90000,
  );
});
