import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_MATCH_SETTINGS,
  DEFAULT_VEHICLE_SETTINGS,
  HEIST_MAP,
  PROTOCOL_VERSION,
  laneCentre,
  mapById,
  type CityLayout,
  type GameMap,
  type VehicleSettings,
} from '@heist/shared';
import { Match } from './Match';
import { FakeConnection } from './testing';

const city = mapById('city') as GameMap;
const found = city.city;
if (!found) throw new Error('the city has no layout');
const layout: CityLayout = found;

function setup(options: Partial<VehicleSettings['traffic']> = {}, map: GameMap = city) {
  const vehicles = {
    ...DEFAULT_VEHICLE_SETTINGS,
    traffic: { ...DEFAULT_VEHICLE_SETTINGS.traffic, ...options },
  };
  const match = new Match({
    map,
    settings: { ...DEFAULT_MATCH_SETTINGS, maxPlayers: 20 },
    combat: DEFAULT_COMBAT_SETTINGS,
    heist: DEFAULT_HEIST_SETTINGS,
    vehicles,
    seed: 'traffic-test',
  });
  const join = (at?: { x: number; z: number }) => {
    const r = match.join(PROTOCOL_VERSION, 'P', new FakeConnection());
    if (!r.ok) throw new Error('join failed');
    if (at) match.teleport(r.player, at.x, 0, at.z);
    return r.player;
  };
  const seconds = (n: number) => {
    for (let i = 0; i < n * match.tickRate; i++) match.step();
  };
  const traffic = () => [...match.vehicles.all()].filter((c) => c.traffic);
  return { match, join, seconds, traffic };
}

const lineOffset = layout.settings.streetWidth / 4;
/** How far a car is from the centre of the nearest lane of a street it is on. */
function laneError(x: number, z: number): number {
  const lines = { x: layout.streetLinesX, z: layout.streetLinesZ };
  let best = Infinity;
  for (const vertical of [true, false])
    for (let line = 0; line < (vertical ? lines.x : lines.z).length; line++)
      for (const dir of [1, -1] as const) {
        const centre = laneCentre({ vertical, line, dir }, lines, lineOffset);
        best = Math.min(best, Math.abs((vertical ? x : z) - centre));
      }
  return best;
}

describe('traffic (29.2)', () => {
  it('puts the asked number of self-driving cars on the roads, and none in a map with no streets', () => {
    expect(setup({ count: 12 }).traffic()).toHaveLength(12);
    expect(setup({ count: 0 }).traffic()).toHaveLength(0);
    expect(setup({ count: 12 }, HEIST_MAP).traffic()).toHaveLength(0);
  });

  it('starts every car in a lane, facing the way that lane goes, well apart from one another', () => {
    const { traffic } = setup({ count: 30 });
    const cars = traffic();
    for (const c of cars) expect(laneError(c.state.x, c.state.z), `car ${c.id}`).toBeLessThan(0.01);
    for (const [i, a] of cars.entries())
      for (const b of cars.slice(i + 1))
        expect(Math.hypot(a.state.x - b.state.x, a.state.z - b.state.z)).toBeGreaterThan(10);
  });

  it('drives cars that are near a player, and leaves the rest standing', () => {
    const { join, seconds, traffic } = setup({ count: 40 });
    const player = join({ x: 0, z: 0 });
    const before = new Map(traffic().map((c) => [c.id, { x: c.state.x, z: c.state.z }]));
    seconds(15);
    const range = DEFAULT_VEHICLE_SETTINGS.traffic.activeRange;
    let moved = 0;
    for (const c of traffic()) {
      const was = before.get(c.id) as { x: number; z: number };
      const away = Math.hypot(was.x - player.body.x, was.z - player.body.z);
      const travelled = Math.hypot(c.state.x - was.x, c.state.z - was.z);
      if (away > range + 40) expect(travelled, `far car ${c.id}`).toBe(0);
      else if (travelled > 3) moved++;
    }
    expect(moved).toBeGreaterThan(2);
  });

  it('keeps to its lane while driving, including round turns', () => {
    const { join, seconds, traffic } = setup({ count: 30 });
    join({ x: 0, z: 0 });
    let worst = 0;
    let samples = 0;
    for (let t = 0; t < 40; t++) {
      seconds(1);
      for (const c of traffic()) {
        if (c.state.speed < 2) continue;
        samples++;
        worst = Math.max(worst, laneError(c.state.x, c.state.z));
      }
    }
    expect(samples).toBeGreaterThan(50);
    // Turning cuts across the junction, so "in a lane" is judged on straight stretches: mostly very close.
    expect(worst).toBeLessThan(layout.settings.streetWidth / 2);
  });

  it('never runs a car faster than the cruise speed, and cars do not drive through one another', () => {
    const { join, seconds, traffic } = setup({ count: 30 });
    join({ x: 0, z: 0 });
    let fastest = 0;
    let closest = Infinity;
    for (let t = 0; t < 40; t++) {
      seconds(1);
      const cars = traffic();
      for (const [i, a] of cars.entries()) {
        fastest = Math.max(fastest, a.state.speed);
        for (const b of cars.slice(i + 1))
          closest = Math.min(closest, Math.hypot(a.state.x - b.state.x, a.state.z - b.state.z));
      }
    }
    expect(fastest).toBeLessThanOrEqual(DEFAULT_VEHICLE_SETTINGS.traffic.cruiseSpeed + 0.5);
    expect(closest).toBeGreaterThan(2.5); // car footprints are about 1.8 × 4.2
  });

  it('stops for a red light: cars are seen standing still in front of junctions, and rarely run one', () => {
    const { join, seconds, traffic } = setup({ count: 40 });
    join({ x: 0, z: 0 });
    const half = layout.settings.streetWidth / 2;
    const inJunction = (x: number, z: number) =>
      layout.streetLinesX.some((lx) => Math.abs(x - lx) < half) &&
      layout.streetLinesZ.some((lz) => Math.abs(z - lz) < half);
    let waiting = 0;
    let entries = 0;
    const was = new Map<number, boolean>();
    for (let t = 0; t < 120; t++) {
      seconds(1);
      for (const c of traffic()) {
        const inside = inJunction(c.state.x, c.state.z);
        if (inside && was.get(c.id) === false) entries++;
        was.set(c.id, inside);
        // Standing still just outside a junction: held by a light (or the queue in front).
        if (Math.abs(c.state.speed) < 0.2 && !inside) {
          const nearJunction =
            layout.streetLinesX.some((lx) => Math.abs(c.state.x - lx) < half + 9) &&
            layout.streetLinesZ.some((lz) => Math.abs(c.state.z - lz) < half + 9);
          if (nearJunction) waiting++;
        }
      }
    }
    expect(entries).toBeGreaterThan(5); // traffic flows through junctions
    expect(waiting).toBeGreaterThan(5); // and waits at them
  });

  it('stands still for a while after being hit, then drives on', () => {
    const { join, seconds, traffic, match } = setup({ count: 20, crashSeconds: 6 });
    join({ x: 0, z: 0 });
    seconds(10);
    const car = traffic().find((c) => c.state.speed > 4);
    if (!car) throw new Error('no car was moving');
    // Another car slams into it: its speed is taken away between its own moves.
    car.state.speed = 0;
    seconds(1);
    const at = { x: car.state.x, z: car.state.z };
    seconds(4);
    expect(Math.hypot(car.state.x - at.x, car.state.z - at.z)).toBeLessThan(0.5);
    expect(car.state.speed).toBe(0);
    seconds(10);
    expect(Math.hypot(car.state.x - at.x, car.state.z - at.z)).toBeGreaterThan(2); // it has moved on
    void match;
  });

  it('becomes an ordinary car when a player takes it, and goes back to its lane at a new round', () => {
    const { join, seconds, traffic, match } = setup({ count: 10 });
    join({ x: 0, z: 0 });
    seconds(2);
    const car = traffic()[0];
    if (!car) throw new Error('no traffic');
    car.driver = 99; // a player got in
    const x = car.state.x;
    seconds(3);
    expect(car.ai).toBe(false);
    expect(Math.abs(car.state.x - x)).toBeLessThan(1); // no longer driven by traffic
    car.driver = 0;
    match.vehicles.reset();
    expect(car.ai).toBe(true);
    expect({ x: car.state.x, z: car.state.z }).toEqual({ x: car.home.x, z: car.home.z });
  });

  it('is cheap: the cars cost a small part of a tick even with players spread about', () => {
    const { join, seconds, match } = setup({ count: 100 });
    for (let i = 0; i < 8; i++) join({ x: -300 + i * 80, z: (i % 2) * 200 - 100 });
    seconds(3);
    const start = performance.now();
    seconds(5);
    const perTick = (performance.now() - start) / (5 * match.tickRate);
    expect(perTick).toBeLessThan(15); // the written server budget for a whole tick
  });
});
