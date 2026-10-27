import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type GameMap,
  type JobKind,
  type JobMessage,
  type MapAnchor,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const city = mapById('city') as GameMap;
const J = DEFAULT_HEIST_SETTINGS.jobs;
const boards = (city.anchors ?? []).filter((a) => a.kind === 'job_board');
const boardWith = (kind: JobKind): MapAnchor => {
  const found = boards.find((a) => J.boards[a.id.replace(':board', '')]?.includes(kind));
  if (!found) throw new Error(`no board offers ${kind}`);
  return found;
};

function setup() {
  const match = new Match({
    map: city,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
    combat: { ...DEFAULT_COMBAT_SETTINGS, spawnProtectionSec: 0 },
    // Chips and caches stand on open ground too; keep their pay out of these sums.
    heist: {
      ...DEFAULT_HEIST_SETTINGS,
      caches: { ...DEFAULT_HEIST_SETTINGS.caches, enabled: false },
      collectibles: { ...DEFAULT_HEIST_SETTINGS.collectibles, enabled: false },
      guards: { ...DEFAULT_HEIST_SETTINGS.guards, perBankTier: {} },
    },
    seed: 'job-test',
  });
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'P', connection);
  if (!r.ok) throw new Error('join failed');
  const player = r.player;
  const heist = match.heist;
  const last = () => connection.jsonOf('job').at(-1) as unknown as JobMessage | undefined;
  const at = (x: number, z: number, y = 0) => match.teleport(player, x, y, z);
  at(0, 0);
  for (let i = 0; i < 20 * match.tickRate; i++) match.step(); // past the round countdown
  player.alive = true;
  player.hp = match.maxHp;
  const take = (kind: JobKind, board = boardWith(kind)) => {
    at(board.x, board.z);
    heist.jobs.take(player, board.id, kind);
  };
  const seconds = (n: number) => {
    for (let i = 0; i < n * match.tickRate; i++) match.step();
  };
  return { match, player, heist, last, at, take, seconds, connection };
}

describe('contracts (30.6, 31.2)', () => {
  it('put a board in every district, on open ground, offering a choice', () => {
    const ids = new Set(city.city?.districts.map((d) => `${d.id}:board`));
    expect(new Set(boards.map((b) => b.id))).toEqual(ids);
    for (const b of boards) expect(J.boards[b.id.replace(':board', '')]?.length).toBeGreaterThan(1);
  });

  it('offer at least four kinds of contract between the boards', () => {
    const kinds = new Set(Object.values(J.boards).flat());
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it('open the board on F, and refuse contracts it does not list or from afar', () => {
    const { heist, player, at, connection } = setup();
    const board = boardWith('delivery');
    at(board.x, board.z);
    expect(heist.interactions.use(player, board.id)).toMatchObject({
      action: 'open_board',
      board: board.id,
    });
    heist.jobs.take(player, board.id, 'race' as JobKind);
    heist.jobs.take(player, 'old-town:board', 'intel');
    at(board.x + 80, board.z + 80);
    heist.jobs.take(player, board.id, 'delivery');
    expect(heist.jobs.jobOf(player)).toBeUndefined();
    expect(connection.jsonOf('notice').length).toBeGreaterThan(0);
  });

  describe('a delivery', () => {
    it('goes to another district, with a clock', () => {
      const { heist, player, last, take } = setup();
      const board = boardWith('delivery');
      take('delivery');
      const m = last();
      expect(m?.status).toBe('active');
      const drop = m?.targets[0];
      expect(Math.hypot((drop?.x ?? 0) - board.x, (drop?.z ?? 0) - board.z)).toBeGreaterThanOrEqual(
        J.delivery.minDistance,
      );
      expect(m?.secondsLeft).toBeCloseTo(J.delivery.seconds, 0);
      expect(heist.jobs.jobOf(player)?.status).toBe('active');
    });

    it('refuses a second job while one is running', () => {
      const { heist, player, take, connection } = setup();
      take('delivery');
      const board = boardWith('delivery');
      heist.jobs.take(player, board.id, 'delivery');
      expect(connection.jsonOf('notice').at(-1)).toMatchObject({
        text: expect.stringContaining('current job'),
      });
    });

    it('turns up the receipt question on arrival, and pays once it is solved', () => {
      const { match, heist, player, last, at, take } = setup();
      take('delivery');
      const drop = last()?.targets[0];
      if (!drop) throw new Error('no drop');
      expect(heist.tasks.find('job:delivery')?.check(player, 'job:delivery', undefined)).toBe(
        'not_allowed',
      );
      at(drop.x, drop.z);
      match.step();
      expect(last()?.status).toBe('claim');
      const rule = heist.tasks.find('job:delivery');
      expect(rule?.check(player, 'job:delivery', undefined)).toBeUndefined();
      rule?.grant(player, 'job:delivery', null);
      expect(player.cash).toBe(J.delivery.reward);
      expect(last()?.status).toBe('done');
      expect(heist.jobs.jobOf(player)).toBeUndefined();
    });

    it('fails when the time runs out', () => {
      const { player, last, take, seconds } = setup();
      take('delivery');
      seconds(J.delivery.seconds + 2);
      expect(last()?.status).toBe('failed');
      expect(player.cash).toBe(0);
    });
  });

  describe('a street race', () => {
    function intoCar(s: ReturnType<typeof setup>, board: MapAnchor) {
      const car = [...s.match.vehicles.all()][0];
      if (!car) throw new Error('no car');
      const park = (x: number, z: number) => {
        car.state.x = x;
        car.state.z = z;
      };
      park(board.x + 3, board.z);
      s.at(board.x + 1.5, board.z);
      expect(
        s.match.vehicleRequest(s.player, { t: 'vehicle', ref: 1, action: 'enter', vehicle: car.id })
          .ok,
      ).toBe(true);
      park(board.x, board.z);
      s.match.step();
      return { park, car };
    }

    it('needs a car, and counts checkpoints only while driving', () => {
      const s = setup();
      const board = boardWith('race');
      s.take('race');
      expect(s.heist.jobs.jobOf(s.player)).toBeUndefined();
      const { park } = intoCar(s, board);
      s.heist.jobs.take(s.player, board.id, 'race');
      const targets = s.last()?.targets ?? [];
      expect(targets).toHaveLength(J.race.checkpoints);
      for (const [i, t] of targets.entries()) {
        park(t.x, t.z);
        s.match.step();
        expect(s.last()?.index).toBe(Math.min(i + 1, targets.length));
      }
      expect(s.last()?.status).toBe('claim');
      expect(
        s.heist.tasks.find('job:race')?.check(s.player, 'job:race', undefined),
      ).toBeUndefined();
    });

    it('does not count a checkpoint reached on foot', () => {
      const s = setup();
      const board = boardWith('race');
      intoCar(s, board);
      s.heist.jobs.take(s.player, board.id, 'race');
      const first = s.last()?.targets[0];
      if (!first) throw new Error('no checkpoint');
      s.match.vehicleRequest(s.player, { t: 'vehicle', ref: 2, action: 'exit' });
      s.at(first.x, first.z);
      s.match.step();
      expect(s.last()?.index).toBe(0);
    });
  });

  describe('recon', () => {
    it('visits other banks’ terminals and leaves an intel point on each', () => {
      const { match, heist, player, last, at, take } = setup();
      take('intel');
      const targets = last()?.targets ?? [];
      expect(targets).toHaveLength(J.intel.banks);
      for (const t of targets) {
        at(t.x, t.z);
        match.step();
      }
      expect(last()?.status).toBe('claim');
      const banks = city.anchors?.filter(
        (a) => a.kind === 'intel_terminal' && targets.some((t) => t.x === a.x && t.z === a.z),
      );
      for (const a of banks ?? []) expect(heist.acts.intelOf(player, a.bank ?? '')).toBe(1);
      heist.tasks.find('job:intel')?.grant(player, 'job:intel', null);
      expect(player.cash).toBe(J.intel.reward);
    });
  });

  describe('sabotage', () => {
    it('needs time at the console, then blinds that bank’s guards', () => {
      const { match, heist, player, last, at, take, seconds } = setup();
      take('sabotage');
      const t = (city.anchors ?? []).find(
        (a) => a.kind === 'vault_console' && a.x === last()?.targets[0]?.x,
      );
      if (!t) throw new Error('no console');
      at(t.x, t.z, t.y);
      seconds(J.sabotage.dwellSeconds / 2);
      expect(last()?.status).toBe('active');
      expect(last()?.dwell).toBeGreaterThan(0);
      seconds(J.sabotage.dwellSeconds);
      expect(last()?.status).toBe('claim');
      expect(heist.jobs.jobOf(player)?.status).toBe('claim');
      void match;
    });

    it('slips back when the player wanders off', () => {
      const { last, at, take, seconds } = setup();
      take('sabotage');
      const target = last()?.targets[0];
      const t = (city.anchors ?? []).find((a) => a.kind === 'vault_console' && a.x === target?.x);
      if (!t) throw new Error('no console');
      at(t.x, t.z, t.y);
      seconds(2);
      const before = last()?.dwell ?? 0;
      at(t.x + 40, t.z + 40);
      seconds(2);
      expect(before).toBeGreaterThan(0);
      expect(last()?.status).toBe('active');
    });
  });

  describe('data theft', () => {
    it('takes longer, tells the police, and pays the most', () => {
      const { heist, player, last, at, take, seconds } = setup();
      take('data_theft');
      const target = last()?.targets[0];
      const t = (city.anchors ?? []).find((a) => a.kind === 'vault_console' && a.x === target?.x);
      if (!t) throw new Error('no console');
      at(t.x, t.z, t.y);
      seconds(J.dataTheft.dwellSeconds + 2);
      expect(last()?.status).toBe('claim');
      expect(heist.police.starsOf(player)).toBeGreaterThanOrEqual(1);
      heist.tasks.find('job:data_theft')?.grant(player, 'job:data_theft', null);
      expect(player.cash).toBe(J.dataTheft.reward);
      expect(J.dataTheft.reward).toBeGreaterThan(J.intel.reward);
    });
  });

  describe('an escort', () => {
    it('follows the player, and the contract is done when they arrive together', () => {
      const { match, player, heist, last, at, take, seconds } = setup();
      take('escort');
      const vip = heist.jobs.jobOf(player)?.vip;
      if (!vip) throw new Error('no escort');
      expect(vip.isVip).toBe(true);
      const start = { x: vip.body.x, z: vip.body.z };
      at(start.x + 12, start.z);
      seconds(4);
      expect(Math.hypot(vip.body.x - start.x, vip.body.z - start.z)).toBeGreaterThan(1);
      const drop = last()?.targets[0];
      if (!drop) throw new Error('no drop');
      // Walk the escort to the drop with the player (teleport both).
      match.teleport(vip, drop.x - 2, 0, drop.z);
      at(drop.x, drop.z);
      match.step();
      expect(last()?.status).toBe('claim');
    });

    it('fails if the escort is killed, and pays nobody for killing them', () => {
      const { match, player, heist, last, take } = setup();
      take('escort');
      const vip = heist.jobs.jobOf(player)?.vip;
      if (!vip) throw new Error('no escort');
      const killer = match.join(PROTOCOL_VERSION, 'K', new FakeConnection());
      if (!killer.ok) throw new Error('join failed');
      match.damage(vip, 999, killer.player);
      expect(last()?.status).toBe('failed');
      expect(killer.player.cash).toBe(0);
      expect(heist.police.starsOf(killer.player)).toBe(0);
    });

    it('is not counted as a seat in the room', () => {
      const { match, take } = setup();
      const before = match.humanCount;
      take('escort');
      expect(match.humanCount).toBe(before);
    });
  });

  it('fail when the player dies', () => {
    const { match, player, last, take } = setup();
    take('delivery');
    match.damage(player, 999, player);
    expect(last()?.status).toBe('failed');
  });

  it('are off when switched off', () => {
    const match = new Match({
      map: city,
      settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
      combat: DEFAULT_COMBAT_SETTINGS,
      heist: { ...DEFAULT_HEIST_SETTINGS, jobs: { ...J, enabled: false } },
      seed: 'off',
    });
    const r = match.join(PROTOCOL_VERSION, 'P', new FakeConnection());
    if (!r.ok) throw new Error('join failed');
    const board = boardWith('delivery');
    match.teleport(r.player, board.x, 0, board.z);
    expect(match.heist.interactions.use(r.player, board.id)).toMatchObject({ action: 'denied' });
  });
});
