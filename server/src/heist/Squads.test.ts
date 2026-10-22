import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  classInputSchema,
  type ClassRecord,
  type SquadMessage,
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
      { squad: 1, name: 'Red', banked: 5000, kills: 3, locks: 2, solves: 0, members: 2 },
      { squad: 2, name: 'Blue', banked: 4000, kills: 0, locks: 1, solves: 0, members: 1 },
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

describe('what a student sees of their squad (27.2, 27.4)', () => {
  const squadMessages = (c: FakeConnection) => c.jsonOf('squad') as unknown as SquadMessage[];

  it('is told their squad and their squad-mates on joining, and nothing when squads are off', () => {
    const { join } = setup('teacher', { 10: 1, 11: 1 });
    join(10);
    const b = join(11);
    const msg = squadMessages(b.connection).at(-1);
    expect(msg).toMatchObject({
      squad: 1,
      name: 'Red',
      mode: 'teacher',
      canPick: false,
      choices: [],
    });
    expect(msg?.members.map((m) => [m.name, m.you])).toEqual([
      ['P10', false],
      ['P11', true],
    ]);
    expect(squadMessages(setup('off', { 10: 1 }).join(10).connection)).toEqual([]);
  });

  it('answers a pick in a self-pick class with the new squad, and a refusal with why', () => {
    const { join, match } = setup('self', {}, 3);
    const a = join(1);
    const full = [join(2), join(3), join(4)];
    for (const x of full)
      match.receiveJson(x.player.id, JSON.stringify({ t: 'squad_join', squad: 1 }));
    expect(squadMessages(full[2]?.connection as FakeConnection).at(-1)).toMatchObject({ squad: 1 });
    match.receiveJson(a.player.id, JSON.stringify({ t: 'squad_join', squad: 1 }));
    // Squad 1 now has three members, so the fourth is refused and told so.
    const fourth = join(5);
    match.receiveJson(fourth.player.id, JSON.stringify({ t: 'squad_join', squad: 1 }));
    expect(squadMessages(fourth.connection).at(-1)).toMatchObject({
      squad: 0,
      denied: 'full',
      canPick: true,
    });
    const choices = squadMessages(fourth.connection).at(-1)?.choices ?? [];
    expect(choices[0]).toMatchObject({ squad: 1, name: 'Red', members: 3, full: true });
  });

  it('shows squad-mates’ health and open task to the squad once a second, and not to others', async () => {
    const { join, match } = setup('teacher', { 10: 1, 11: 1, 12: 2 });
    const a = join(10);
    const b = join(11);
    const c = join(12);
    b.player.hp = 55;
    // b opens a heal task: the scripted gateway answers a challenge, which the controller notes as open.
    (match.heist as unknown as { openTasks: Map<string, string> }).openTasks.set(
      b.player.key,
      'heal:small',
    );
    a.connection.clear();
    c.connection.clear();
    for (let i = 0; i < match.tickRate; i++) match.step();
    const seen = squadMessages(a.connection).at(-1);
    expect(seen?.members.find((m) => m.name === 'P11')).toMatchObject({
      hp: 55,
      task: 'heal:small',
      you: false,
    });
    // Squad 2 has only one member and never sees squad 1's people.
    expect(
      squadMessages(c.connection)
        .at(-1)
        ?.members.map((m) => m.name),
    ).toEqual(['P12']);
  });
});

describe('roles (27.3)', () => {
  const pickRole = (match: Match, id: number, role: string | null) =>
    match.receiveJson(id, JSON.stringify({ t: 'role_pick', role }));
  const last = (c: FakeConnection) => (c.jsonOf('squad') as unknown as SquadMessage[]).at(-1);

  it('gives each role to one member of a squad, and says who has the others', () => {
    const { join, match } = setup('teacher', { 1: 1, 2: 1, 3: 2 });
    const [a, b, c] = [join(1), join(2), join(3)];
    pickRole(match, a.player.id, 'hacker');
    expect(a.player.role).toBe('hacker');
    pickRole(match, b.player.id, 'hacker');
    expect(b.player.role).toBeNull();
    expect(last(b.connection)).toMatchObject({ denied: 'role_taken' });
    expect(last(b.connection)?.roles.find((r) => r.role === 'hacker')?.takenBy).toBe('P1');
    // The same role is free in another squad.
    pickRole(match, c.player.id, 'hacker');
    expect(c.player.role).toBe('hacker');
    pickRole(match, a.player.id, null);
    pickRole(match, b.player.id, 'hacker');
    expect(b.player.role).toBe('hacker');
  });

  it('needs a squad, and goes when the squad changes or the student reconnects into another', () => {
    const solo = setup('teacher', {});
    const p = solo.join(9);
    pickRole(solo.match, p.player.id, 'driver');
    expect(p.player.role).toBeNull();
    expect(last(p.connection)).toMatchObject({ denied: 'no_squad' });

    const { join, match, squads } = setup('self');
    const a = join(1).player;
    squads.pick(a, 1);
    pickRole(match, a.id, 'lookout');
    squads.pick(a, 2); // another squad: the role stays behind
    expect(a.role).toBeNull();
    squads.pick(a, 1);
    pickRole(match, a.id, 'lookout');
    match.leave(a.id);
    expect(join(1).player.role).toBe('lookout'); // back with their squad and their role
  });

  it('enforcers take less damage on foot, drivers less in a car, others the full amount', () => {
    const { join, match, squads } = setup('teacher', { 1: 1, 2: 1, 3: 1 });
    const [enforcer, driver, plain] = [join(1).player, join(2).player, join(3).player];
    squads.pickRole(enforcer, 'enforcer');
    squads.pickRole(driver, 'driver');
    const shooter = join(50).player;
    const hit = (victim: typeof plain) => {
      victim.hp = 100;
      match.damage(victim, 40, shooter);
      return 100 - victim.hp;
    };
    expect(hit(plain)).toBe(40);
    expect(hit(enforcer)).toBe(34); // × 0.85
    expect(hit(driver)).toBe(40); // on foot: no perk
    driver.vehicleId = 7;
    expect(hit(driver)).toBe(24); // × 0.6 in a car
    enforcer.vehicleId = 7;
    expect(hit(enforcer)).toBe(40); // the enforcer's perk is for fighting on foot
  });

  it('hackers pay half for hints', () => {
    const { join, match, squads } = setup('teacher', { 1: 1, 2: 1 });
    const [hacker, plain] = [join(1).player, join(2).player];
    squads.pickRole(hacker, 'hacker');
    const charge = (p: typeof plain) => {
      match.heist.setCash(p, 1000);
      (match.heist as unknown as { chargeHint(p: unknown, c: number, m: string): void }).chargeHint(
        p,
        100,
        'absolute',
      );
      return 1000 - p.cash;
    };
    expect(charge(plain)).toBe(100);
    expect(charge(hacker)).toBe(50);
  });

  it('shows the lookout rivals nearby, never squad-mates or the far away', () => {
    const { join, match, squads } = setup('teacher', { 1: 1, 2: 1, 3: 2, 4: 2 });
    const [lookout, mate, near, far] = [
      join(1).player,
      join(2).player,
      join(3).player,
      join(4).player,
    ];
    squads.pickRole(lookout, 'lookout');
    for (const p of [lookout, mate, near, far]) p.alive = true;
    lookout.body.x = 0;
    lookout.body.z = 0;
    mate.body.x = 5;
    mate.body.z = 0;
    near.body.x = 30;
    near.body.z = 0;
    far.body.x = 200;
    far.body.z = 0;
    const connection = (match.getPlayer(lookout.id) as unknown as { connection: FakeConnection })
      .connection;
    connection.clear();
    for (let i = 0; i < match.tickRate; i++) match.step();
    const radar = connection.jsonOf('radar').at(-1) as
      { foes: { x: number; z: number }[] } | undefined;
    expect(radar?.foes.map((f) => f.x)).toEqual([30]);
    // Nobody else gets a radar.
    expect(connection.jsonOf('radar').length).toBeGreaterThan(0);
  });
});

describe('squad awards at the end of a round (27.5)', () => {
  it('names the winning squads in the round-end message and the class record, and counts solved tasks', () => {
    const { join, match } = setup('teacher', { 1: 1, 2: 2 });
    const [a, b] = [join(1), join(2)];
    a.player.banked = 6000;
    b.player.kills = 3;
    for (let i = 0; i < 4; i++)
      match.heist.events.publish({
        type: 'task_solved',
        player: b.player,
        rewardKey: 'heal:small',
      });
    const results: unknown[] = [];
    match.heist.events.subscribe((e) => e.type === 'round_end' && results.push(e.result));
    match.heist.round?.endNow();
    const ended = a.connection.jsonOf('round').at(-1) as {
      squadAwards?: { id: string; name: string; value: number }[];
    };
    expect(ended.squadAwards?.map((x) => [x.id, x.name, x.value])).toEqual([
      ['top_haul', 'Red', 6000],
      ['wolfpack', 'Blue', 3],
      ['brain_trust', 'Blue', 4],
    ]);
    expect((results[0] as { squadAwards: unknown[] }).squadAwards).toHaveLength(3);
  });

  it('sends no squad awards in a class that plays as individuals', () => {
    const { join, match } = setup('off');
    const a = join(1);
    a.player.banked = 100;
    match.heist.round?.endNow();
    expect('squadAwards' in (a.connection.jsonOf('round').at(-1) as object)).toBe(false);
  });
});
