import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_SETTINGS } from '@heist/shared';
import { startGame, type RunningGame } from './startGame';

let game: RunningGame | undefined;
afterEach(async () => {
  await game?.stop();
  game = undefined;
});

describe('startGame metrics', () => {
  it('reports players, tick time and bandwidth for /metrics', async () => {
    game = startGame(createServer(), { ...DEFAULT_MATCH_SETTINGS, sandboxDummies: 2 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const m = game.metrics();
    expect(m.players).toBe(2); // the dummies
    expect(m.tick).toBeGreaterThan(3);
    expect(m.tickMs.max).toBeGreaterThanOrEqual(m.tickMs.p50);
    expect(m.bytesPerSecond).toBeGreaterThanOrEqual(0);
  });
});
