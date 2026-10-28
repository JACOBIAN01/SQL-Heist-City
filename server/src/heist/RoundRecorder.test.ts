import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  REPLAY_STEP_SECONDS,
  mapById,
  type GameMap,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const city = mapById('city') as GameMap;

function setup() {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: DEFAULT_HEIST_SETTINGS,
    seed: 'recorder',
  });
  const join = (name: string) => {
    const r = match.join(PROTOCOL_VERSION, name, new FakeConnection());
    if (!r.ok) throw new Error('join failed');
    return r.player;
  };
  const ana = join('Ana');
  const ben = join('Ben');
  for (let i = 0; i < 20 * match.tickRate; i++) match.step();
  return { match, ana, ben, heist: match.heist };
}

describe('the round recorder (35.2)', () => {
  it('notes where each student stands every few seconds', () => {
    const { match, heist } = setup();
    heist.recorder.reset();
    for (let i = 0; i <= 2 * REPLAY_STEP_SECONDS * match.tickRate; i++) match.step();
    const r = heist.recorder.snapshot();
    expect(r.tracks.map((t) => t.name).sort()).toEqual(['Ana', 'Ben']);
    expect(r.tracks[0]?.points.length).toBe(2 * 2);
    expect(r.step).toBe(REPLAY_STEP_SECONDS);
  });

  it('keeps kills, solved questions and banked cash, naming students only', () => {
    const { match, ana, ben, heist } = setup();
    heist.recorder.reset();
    heist.events.publish({ type: 'task_solved', player: ben, rewardKey: 'heal:small', seconds: 9 });
    match.damage(ana, 999, ben);
    heist.events.publish({ type: 'banked', player: ben, amount: 700 });
    const events = heist.recorder.snapshot().events;
    expect(events.map((e) => [e.kind, e.who, e.other, e.text])).toEqual([
      ['solved', 'Ben', undefined, 'heal:small'],
      ['kill', 'Ben', 'Ana', undefined],
      ['banked', 'Ben', undefined, '700'],
    ]);
  });

  it('starts empty for a new round, and leaves guards out', () => {
    const { match, ben, heist } = setup();
    heist.events.publish({ type: 'banked', player: ben, amount: 1 });
    heist.recorder.reset();
    expect(heist.recorder.snapshot().events).toEqual([]);
    ben.isGuard = true;
    for (let i = 0; i <= REPLAY_STEP_SECONDS * match.tickRate; i++) match.step();
    expect(heist.recorder.snapshot().tracks.map((t) => t.name)).toEqual(['Ana']);
  });
});
