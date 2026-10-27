import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  mapById,
  type GameMap,
  type JobMessage,
  type MapAnchor,
} from '@heist/shared';
import { Match } from '../game/Match';
import { FakeConnection } from '../game/testing';

const city = mapById('city') as GameMap;
const boards = (city.anchors ?? []).filter((a) => a.kind === 'job_board');
const boardOfKind = (kind: 'delivery' | 'race'): MapAnchor => {
  const found = boards.find(
    (a) => DEFAULT_HEIST_SETTINGS.jobs.boards[a.id.replace(':board', '')] === kind,
  );
  if (!found) throw new Error(`no ${kind} board`);
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
    },
    seed: 'job-test',
  });
  const connection = new FakeConnection();
  const r = match.join(PROTOCOL_VERSION, 'P', connection);
  if (!r.ok) throw new Error('join failed');
  const player = r.player;
  const heist = match.heist;
  const last = () => connection.jsonOf('job').at(-1) as unknown as JobMessage | undefined;
  const at = (x: number, z: number) => match.teleport(player, x, 0, z);
  // Past the round countdown, which clears everything.
  at(0, 0);
  for (let i = 0; i < 20 * match.tickRate; i++) match.step();
  return { match, player, heist, last, at };
}

describe('side jobs (30.6)', () => {
  it('put a board in every district, on open ground', () => {
    const ids = new Set(city.city?.districts.map((d) => `${d.id}:board`));
    expect(new Set(boards.map((b) => b.id))).toEqual(ids);
  });

  it('start a delivery at a board, to another district, with a clock', () => {
    const { heist, player, last, at } = setup();
    const board = boardOfKind('delivery');
    at(board.x, board.z);
    expect(heist.interactions.use(player, board.id)).toEqual({
      action: 'job_started',
      kind: 'delivery',
    });
    const m = last();
    expect(m?.status).toBe('active');
    expect(m?.targets).toHaveLength(1);
    const drop = m?.targets[0];
    expect(Math.hypot((drop?.x ?? 0) - board.x, (drop?.z ?? 0) - board.z)).toBeGreaterThanOrEqual(
      DEFAULT_HEIST_SETTINGS.jobs.delivery.minDistance,
    );
    expect(m?.secondsLeft).toBeCloseTo(DEFAULT_HEIST_SETTINGS.jobs.delivery.seconds, 0);
    expect(heist.jobs.jobOf(player)?.status).toBe('active');
  });

  it('refuse a second job while one is running', () => {
    const { match, heist, player, at } = setup();
    const board = boardOfKind('delivery');
    at(board.x, board.z);
    heist.interactions.use(player, board.id);
    for (let i = 0; i < 2 * match.tickRate; i++) match.step(); // the use cooldown
    expect(heist.interactions.use(player, board.id)).toEqual({ action: 'denied', reason: 'busy' });
  });

  it('turn up the receipt question on arrival, and pay once it is solved', () => {
    const { match, heist, player, last, at } = setup();
    const board = boardOfKind('delivery');
    at(board.x, board.z);
    heist.interactions.use(player, board.id);
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
    expect(player.cash).toBe(DEFAULT_HEIST_SETTINGS.jobs.delivery.reward);
    expect(last()?.status).toBe('done');
    expect(heist.jobs.jobOf(player)).toBeUndefined();
  });

  it('fail when the time runs out, and when the player dies', () => {
    const { match, heist, player, last, at } = setup();
    const board = boardOfKind('delivery');
    at(board.x, board.z);
    heist.interactions.use(player, board.id);
    for (let i = 0; i < (DEFAULT_HEIST_SETTINGS.jobs.delivery.seconds + 2) * match.tickRate; i++)
      match.step();
    expect(last()?.status).toBe('failed');
    expect(player.cash).toBe(0);
  });

  it('need a car for a race, and count checkpoints only while driving', () => {
    const { match, heist, player, last, at } = setup();
    const board = boardOfKind('race');
    at(board.x, board.z);
    expect(heist.interactions.use(player, board.id)).toEqual({
      action: 'denied',
      reason: 'need_car',
    });
    // Get into a real car, then move the car (the driver goes where it goes).
    const car = [...match.vehicles.all()][0];
    if (!car) throw new Error('no car');
    const park = (x: number, z: number) => {
      car.state.x = x;
      car.state.z = z;
    };
    park(board.x + 3, board.z);
    at(board.x + 1.5, board.z);
    expect(
      match.vehicleRequest(player, { t: 'vehicle', ref: 1, action: 'enter', vehicle: car.id }).ok,
    ).toBe(true);
    player.interactReadyTick = 0;
    park(board.x, board.z);
    match.step();
    expect(heist.interactions.use(player, board.id)).toEqual({
      action: 'job_started',
      kind: 'race',
    });
    const targets = last()?.targets ?? [];
    expect(targets).toHaveLength(DEFAULT_HEIST_SETTINGS.jobs.race.checkpoints);
    for (const [i, t] of targets.entries()) {
      park(t.x, t.z);
      match.step();
      expect(last()?.index).toBe(Math.min(i + 1, targets.length));
    }
    expect(last()?.status).toBe('claim');
    expect(heist.tasks.find('job:race')?.check(player, 'job:race', undefined)).toBeUndefined();
  });

  it('do not count a race checkpoint reached on foot', () => {
    const { match, heist, player, last, at } = setup();
    const board = boardOfKind('race');
    const car = [...match.vehicles.all()][0];
    if (!car) throw new Error('no car');
    car.state.x = board.x + 3;
    car.state.z = board.z;
    at(board.x + 1.5, board.z);
    match.vehicleRequest(player, { t: 'vehicle', ref: 1, action: 'enter', vehicle: car.id });
    car.state.x = board.x;
    car.state.z = board.z;
    match.step();
    player.interactReadyTick = 0;
    heist.interactions.use(player, board.id);
    const first = last()?.targets[0];
    if (!first) throw new Error('no checkpoint');
    match.vehicleRequest(player, { t: 'vehicle', ref: 2, action: 'exit' });
    at(first.x, first.z);
    match.step();
    expect(last()?.index).toBe(0);
  });

  it('are off when switched off', () => {
    const match = new Match({
      map: city,
      settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20, sandboxDummies: 0 },
      combat: DEFAULT_COMBAT_SETTINGS,
      heist: {
        ...DEFAULT_HEIST_SETTINGS,
        jobs: { ...DEFAULT_HEIST_SETTINGS.jobs, enabled: false },
      },
      seed: 'off',
    });
    const r = match.join(PROTOCOL_VERSION, 'P', new FakeConnection());
    if (!r.ok) throw new Error('join failed');
    const board = boardOfKind('delivery');
    match.teleport(r.player, board.x, 0, board.z);
    expect(match.heist.interactions.use(r.player, board.id)).toMatchObject({ action: 'denied' });
  });
});
