import { describe, expect, it } from 'vitest';
import { replayPositions, type RoundReplay } from './roundReplay';

const replay: RoundReplay = {
  step: 3,
  seconds: 12,
  tracks: [
    { name: 'Ana', from: 0, points: [0, 0, 10, 20, 20, 20] },
    { name: 'Ben', from: 2, points: [5, 5] },
  ],
  events: [],
};

describe('replayPositions', () => {
  it('puts everyone between their samples', () => {
    const p = replayPositions(replay, 1.5);
    expect(p).toEqual([{ name: 'Ana', x: 5, z: 10 }]);
  });
  it('shows a late joiner only from when they arrive, and leaves them where last seen', () => {
    expect(replayPositions(replay, 5).map((x) => x.name)).toEqual(['Ana']);
    const late = replayPositions(replay, 7);
    expect(late.map((x) => x.name)).toEqual(['Ana', 'Ben']);
    expect(replayPositions(replay, 100)).toEqual([
      { name: 'Ana', x: 20, z: 20 },
      { name: 'Ben', x: 5, z: 5 },
    ]);
  });
  it('is empty before anyone is on the map', () => {
    expect(replayPositions({ ...replay, tracks: [] }, 3)).toEqual([]);
  });
});
