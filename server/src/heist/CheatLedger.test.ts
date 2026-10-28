import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type GameMap,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import type { RoundResult } from './HeistEvents';

const city = mapById('city') as GameMap;

describe('who cheated this round (37.3)', () => {
  it('marks a player who passed a question, and shows it in the round table', () => {
    const match = new Match({
      map: city,
      settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
      combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
      heist: { ...DEFAULT_HEIST_SETTINGS, roundMinutes: 0.2 },
      seed: 'ledger',
    });
    const join = (name: string) => {
      const r = match.join(PROTOCOL_VERSION, name, new FakeConnection());
      if (!r.ok) throw new Error('join failed');
      return r.player;
    };
    const ana = join('Ana');
    const ben = join('Ben');
    const results: RoundResult[] = [];
    match.heist.events.subscribe((e) => {
      if (e.type === 'round_end') results.push(e.result);
    });
    for (let i = 0; i < 3 * match.tickRate; i++) match.step();
    match.heist.events.publish({ type: 'task_cheated', player: ana, rewardKey: 'heal:small' });
    expect(match.heist.cheats.has(ana)).toBe(true);
    expect(match.heist.cheats.has(ben)).toBe(false);
    for (let i = 0; i < 40 * match.tickRate && results.length === 0; i++) match.step();
    const table = results[0]?.standings ?? [];
    expect(table.find((s) => s.name === 'Ana')?.cheated).toBe(true);
    expect(table.find((s) => s.name === 'Ben')?.cheated).toBeUndefined();
  });
});
