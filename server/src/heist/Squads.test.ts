import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  classInputSchema,
  type ClassRecord,
  type SquadMode,
} from '@heist/shared';
import { classMatchConfig } from '../classes/ClassMatchConfig';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';
import { ScriptedGateway } from './testing';

const record = (mode: SquadMode, size = 4): ClassRecord => ({
  ...classInputSchema.parse({ name: '9B', playerCap: 60, squadMode: mode, squadSize: size }),
  id: 1,
  code: 'ABCDEF',
  ownerUserId: null,
  locked: false,
  archived: false,
  archivedAt: null,
  consent: null,
  createdAt: '',
  updatedAt: '',
});

function setup(mode: SquadMode, squads: Record<number, number> = {}, size = 4) {
  const match = new Match({
    map: HEIST_MAP,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 200 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    heist: DEFAULT_HEIST_SETTINGS,
    challenges: new ScriptedGateway(),
    classConfig: classMatchConfig(record(mode, size), [], squads),
  });
  const join = (accountId?: number) => {
    const connection = new FakeConnection();
    const r = match.join(PROTOCOL_VERSION, `P${accountId ?? ''}`, connection, accountId);
    if (!r.ok) throw new Error('join failed');
    return { player: r.player, connection };
  };
  return { match, join, squads: match.heist.squads };
}

describe('squads in a class room (27.1)', () => {
  it('puts students in the teacher’s squads on joining, and leaves others alone', () => {
    const { join } = setup('teacher', { 10: 1, 11: 1, 12: 2 });
    expect([10, 11, 12, 13].map((id) => join(id).player.squad)).toEqual([1, 1, 2, 0]);
  });

  it('is off by default: nobody is in a squad and no table is sent', () => {
    const { join, squads } = setup('off', { 10: 1 });
    const a = join(10);
    expect(a.player.squad).toBe(0);
    expect(squads.table()).toEqual([]);
    expect(a.connection.jsonOf('scores').every((m) => !('squads' in (m as object)))).toBe(true);
  });

  it('scores a squad as one: members’ cash and kills added, locks counted, best first', () => {
    const { join, squads, match } = setup('teacher', { 10: 1, 11: 1, 12: 2 });
    const [a, b, c] = [join(10).player, join(11).player, join(12).player];
    const [vault] = [...match.heist.vaults.all()];
    if (!vault) throw new Error('the map has no vault');
    a.banked = 3000;
    a.kills = 1;
    b.banked = 2000;
    b.kills = 2;
    c.banked = 4000;
    match.heist.events.publish({ type: 'lock_opened', vault, lock: 1, player: a });
    match.heist.events.publish({ type: 'lock_opened', vault, lock: 2, player: b });
    match.heist.events.publish({ type: 'lock_opened', vault, lock: 1, player: c });
    expect(squads.table()).toEqual([
      { squad: 1, name: 'Red', banked: 5000, kills: 3, locks: 2, members: 2 },
      { squad: 2, name: 'Blue', banked: 4000, kills: 0, locks: 1, members: 1 },
    ]);
    squads.reset();
    expect(squads.table().map((s) => s.locks)).toEqual([0, 0]);
  });

  it('sends the squad table with the scores, and with the round end', () => {
    const { join, match } = setup('teacher', { 10: 1 });
    const { player, connection } = join(10);
    player.banked = 500;
    match.heist.round?.endNow();
    const ended = connection.jsonOf('round').at(-1) as {
      phase: string;
      squads?: { squad: number }[];
    };
    expect(ended.phase).toBe('ended');
    expect(ended.squads?.map((s) => s.squad)).toEqual([1]);
    const scores = connection.jsonOf('scores').at(-1);
    expect(scores?.squads?.[0]?.banked).toBe(500);
  });

  it('follows the teacher’s edits to the squads while the room runs', () => {
    const { join, match } = setup('teacher', { 10: 1 });
    const { player } = join(10);
    expect(player.squad).toBe(1);
    match.applyClassConfig(classMatchConfig(record('teacher'), [], { 10: 3 }));
    expect(player.squad).toBe(3);
    match.applyClassConfig(classMatchConfig(record('off'), [], { 10: 3 }));
    expect(player.squad).toBe(0);
  });
});

describe('picking a squad yourself (27.2)', () => {
  it('lets a student pick a squad up to its size, and leave it', () => {
    const { join, squads } = setup('self', {}, 3);
    const players = [1, 2, 3, 4].map((id) => join(id).player);
    expect(players.slice(0, 3).map((p) => squads.pick(p, 1))).toEqual(['ok', 'ok', 'ok']);
    expect(squads.pick(players[3] as never, 1)).toBe('full');
    expect(squads.pick(players[3] as never, 2)).toBe('ok');
    expect(squads.pick(players[0] as never, 0)).toBe('ok');
    expect(players[0]?.squad).toBe(0);
    expect(squads.pick(players[3] as never, 1)).toBe('ok'); // a place freed up
  });

  it('refuses unknown squads, picking in a teacher’s class, and moving with cash banked', () => {
    const self = setup('self');
    const a = self.join(1).player;
    expect(self.squads.pick(a, 99)).toBe('unknown_squad');
    expect(self.squads.pick(a, -1)).toBe('unknown_squad');
    a.banked = 100;
    expect(self.squads.pick(a, 1)).toBe('has_banked');
    const teacher = setup('teacher');
    expect(teacher.squads.pick(teacher.join(1).player, 1)).toBe('not_allowed');
  });

  it('remembers a pick across a reconnect during the match', () => {
    const { join, squads, match } = setup('self');
    const first = join(5).player;
    squads.pick(first, 2);
    match.leave(first.id);
    expect(join(5).player.squad).toBe(2);
  });
});
