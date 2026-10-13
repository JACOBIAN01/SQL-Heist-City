import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANALYTICS_SETTINGS as S,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  addItem,
  emptyTotals,
  type ProfileMessage,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { scopeView } from './ProfileAggregator';

/** 15.18: a student sees only their own profile; it never rides on shared messages. */
describe('profile privacy', () => {
  const setup = () => {
    const match = new Match({
      map: HEIST_MAP,
      settings: DEFAULT_MATCH_SETTINGS,
      combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    });
    const join = (name: string, accountId: number) => {
      const connection = new FakeConnection();
      const r = match.join(PROTOCOL_VERSION, name, connection, accountId);
      if (!r.ok) throw new Error('join failed');
      return { player: r.player, connection };
    };
    return { match, join };
  };
  const message = (): ProfileMessage => ({
    t: 'profile',
    all: scopeView(
      addItem(
        emptyTotals(),
        {
          challengeId: 'c',
          questionId: 1,
          questionVersion: 1,
          rewardKey: 'x',
          tier: 1,
          rcsbe: 'C',
          bloom: 'understand',
          marks: 9,
          topics: [],
          outcome: 'solved',
          runs: 1,
          submits: 1,
          wrongSubmits: 0,
          hintsPaid: 0,
          secondsOpen: 5,
          tutorial: false,
          issuedAt: 0,
          finishedAt: 1,
        },
        S,
      ),
      S,
    ),
  });

  it('sends a profile to its owner and to nobody else', () => {
    const { match, join } = setup();
    const ana = join('Ana', 1);
    const ben = join('Ben', 2);
    match.sendProfile(1, message());
    expect(ana.connection.jsonOf('profile')).toHaveLength(1);
    expect(ben.connection.jsonOf('profile')).toHaveLength(0);
  });

  it('never appears in the scoreboard, standings, awards or snapshots everyone gets', () => {
    const { match, join } = setup();
    const ana = join('Ana', 1);
    const ben = join('Ben', 2);
    match.sendProfile(1, message());
    for (let i = 0; i < 3; i++) match.step();
    const shared = [
      ...ben.connection.jsonOf('scores'),
      ...ben.connection.jsonOf('round'),
      ...ben.connection.jsonOf('standing'),
    ];
    expect(JSON.stringify(shared)).not.toMatch(/rcsbe|bloom|earned|marks/);
    expect(ben.connection.jsonOf('profile')).toEqual([]);
    expect(ana.connection.jsonOf('profile')).toHaveLength(1);
  });

  it('is not delivered to a player who is not signed in as that account', () => {
    const { match, join } = setup();
    const anon = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, 'Anon', anon);
    if (!r.ok) throw new Error('join failed');
    join('Ana', 1);
    match.sendProfile(1, message());
    expect(anon.jsonOf('profile')).toEqual([]);
  });
});
