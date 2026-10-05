import { describe, expect, it } from 'vitest';
import {
  Button,
  DEFAULT_MATCH_SETTINGS,
  DEFAULT_MOVEMENT_SETTINGS,
  DEFAULT_VEHICLE_SETTINGS,
  PROTOCOL_VERSION,
  box,
  type GameMap,
  type InputCommand,
  type VehicleMessage,
} from '@heist/shared';
import { Match } from './Match';
import type { Player } from './Player';
import { FakeConnection } from './testing';

/** A car park: a sedan at the origin facing −z, a second car further off, a wall ahead. */
const CAR_PARK: GameMap = {
  id: 'carpark',
  halfSize: 400,
  boxes: [box('wall', 0, -60, 40, 4, 2)],
  spawns: [{ x: 3, z: 0, yaw: 0 }],
  parkedCars: [
    { x: 0, z: 0, yaw: 0, kind: 'sedan', variant: 2 },
    { x: 300, z: 300, yaw: 0, kind: 'suv', variant: 0 },
  ],
};

function setup() {
  const match = new Match({
    map: CAR_PARK,
    settings: { ...DEFAULT_MATCH_SETTINGS, sandboxDummies: 0 },
    now: () => 0,
  });
  const join = (name: string) => {
    const connection = new FakeConnection();
    const result = match.join(PROTOCOL_VERSION, name, connection);
    if (!result.ok) throw new Error('join failed');
    return { player: result.player, connection };
  };
  let seq = 0;
  const input = (p: Player, over: Partial<InputCommand> = {}, count = 3) => {
    const commands = Array.from({ length: count }, () => ({
      seq: ++seq,
      moveX: 0,
      moveY: 0,
      yaw: 0,
      pitch: 0,
      buttons: 0,
      viewLagMs: 0,
      ...over,
    }));
    match.receiveInput(p.id, commands);
    match.step();
  };
  const ask = (p: Player, body: { action: 'enter'; vehicle: number } | { action: 'exit' }) =>
    match.vehicleRequest(p, { t: 'vehicle', ref: 1, ...body } as VehicleMessage);
  return { match, join, input, ask };
}

describe('Match: cars in snapshots', () => {
  it('tells a client about the cars in range, and only again when they change', () => {
    const { match, join } = setup();
    const { connection } = join('Ana');
    match.step();
    const first = connection.of('snapshot').at(-1);
    expect(first?.self.vehicle).toBe(0);
    expect(first?.vehicles.map((v) => v.id)).toEqual([1]); // the far SUV is out of range
    expect(first?.vehicles[0]).toMatchObject({ kind: 'sedan', variant: 2, driver: 0 });
    match.step();
    expect(connection.of('snapshot').at(-1)?.vehicles).toEqual([]);
  });

  it('drops a car from a client that moved out of range', () => {
    const { match, join } = setup();
    const { player, connection } = join('Ana');
    match.step();
    match.teleport(player, 300, 0, 305);
    match.step();
    const last = connection.of('snapshot').at(-1);
    expect(last?.vehiclesRemoved).toEqual([1]);
    expect(last?.vehicles.map((v) => v.id)).toEqual([2]);
  });
});

describe('Match: cars are solid', () => {
  it('stops a player walking into a parked car', () => {
    const { join, input } = setup();
    const { player } = join('Ana'); // spawns at x 3, beside the sedan
    for (let i = 0; i < 40; i++) input(player, { moveY: 127, yaw: Math.PI / 2 }); // toward −x
    expect(player.body.x).toBeGreaterThanOrEqual(
      DEFAULT_VEHICLE_SETTINGS.kinds.sedan.width / 2 + DEFAULT_MOVEMENT_SETTINGS.radius - 1e-6,
    );
  });
});

describe('Match: getting in and driving', () => {
  it('lets a player next to a free car in, and drives it with their input', () => {
    const { match, join, input, ask } = setup();
    const { player, connection } = join('Ana');
    expect(ask(player, { action: 'enter', vehicle: 1 })).toMatchObject({
      ok: false,
      reason: 'too_far',
    });
    match.teleport(player, 1.8, 0, 0);
    expect(ask(player, { action: 'enter', vehicle: 1 })).toMatchObject({ ok: true });
    expect(player.vehicleId).toBe(1);
    for (let i = 0; i < 20; i++) input(player, { moveY: 127 });
    const car = match.vehicles.get(1);
    expect(car?.state.z).toBeLessThan(-3);
    // The driver rides in the car.
    expect(player.body.x).toBe(car?.state.x);
    expect(player.body.z).toBe(car?.state.z);
    const snap = connection.of('snapshot').at(-1);
    expect(snap?.self.vehicle).toBe(1);
  });

  it('does not let two drivers share a car, nor a driver take a second one', () => {
    const { match, join, ask } = setup();
    const a = join('Ana').player;
    const b = join('Ben').player;
    match.teleport(a, 1.8, 0, 0);
    match.teleport(b, -1.8, 0, 0);
    ask(a, { action: 'enter', vehicle: 1 });
    expect(ask(b, { action: 'enter', vehicle: 1 })).toMatchObject({ reason: 'taken' });
    expect(ask(a, { action: 'enter', vehicle: 2 })).toMatchObject({ reason: 'already_driving' });
    expect(ask(b, { action: 'enter', vehicle: 99 })).toMatchObject({ reason: 'unknown_vehicle' });
  });

  it('shows other players who drives which car', () => {
    const { match, join, ask } = setup();
    const a = join('Ana').player;
    const b = join('Ben');
    match.teleport(a, 1.8, 0, 0);
    ask(a, { action: 'enter', vehicle: 1 });
    match.step();
    const seen = b.connection
      .of('snapshot')
      .flatMap((s) => s.vehicles)
      .at(-1);
    expect(seen).toMatchObject({ id: 1, driver: a.id });
  });

  it('never fires a gun from the driver’s seat', () => {
    const { match, join, input, ask } = setup();
    const { player, connection } = join('Ana');
    match.teleport(player, 1.8, 0, 0);
    ask(player, { action: 'enter', vehicle: 1 });
    for (let i = 0; i < 10; i++) input(player, { buttons: Button.Fire });
    expect(connection.of('event').filter((e) => e.event.e === 'shot')).toEqual([]);
  });
});

describe('Match: getting out', () => {
  it('refuses at speed, then puts the driver beside the driver’s door', () => {
    const { match, join, input, ask } = setup();
    const { player } = join('Ana');
    match.teleport(player, 1.8, 0, 0);
    ask(player, { action: 'enter', vehicle: 1 });
    for (let i = 0; i < 20; i++) input(player, { moveY: 127 });
    expect(ask(player, { action: 'exit' })).toMatchObject({ ok: false, reason: 'too_fast' });
    for (let i = 0; i < 40; i++) input(player, { buttons: Button.Jump }); // handbrake
    expect(ask(player, { action: 'exit' })).toMatchObject({ ok: true });
    const car = match.vehicles.get(1);
    expect(player.vehicleId).toBe(0);
    expect(car?.driver).toBe(0);
    // Facing −z the driver's door is on the −x side.
    expect(player.body.x).toBeLessThan((car?.state.x ?? 0) - 1);
    expect(ask(player, { action: 'exit' })).toMatchObject({ reason: 'not_driving' });
  });

  it('uses the other door when the driver’s side is blocked', () => {
    const blocked: GameMap = { ...CAR_PARK, boxes: [box('wall', -2, 0, 1, 3, 10)] };
    const match = new Match({ map: blocked, settings: DEFAULT_MATCH_SETTINGS, now: () => 0 });
    const result = match.join(PROTOCOL_VERSION, 'Ana', new FakeConnection());
    if (!result.ok) throw new Error('join failed');
    const p = result.player;
    match.teleport(p, 1.8, 0, 0);
    match.vehicleRequest(p, { t: 'vehicle', ref: 1, action: 'enter', vehicle: 1 });
    expect(match.vehicleRequest(p, { t: 'vehicle', ref: 2, action: 'exit' })).toMatchObject({
      ok: true,
    });
    expect(p.body.x).toBeGreaterThan(1);
  });

  it('frees the car when its driver leaves, and parks every car for a new round', () => {
    const { match, join, input, ask } = setup();
    const { player } = join('Ana');
    match.teleport(player, 1.8, 0, 0);
    ask(player, { action: 'enter', vehicle: 1 });
    for (let i = 0; i < 10; i++) input(player, { moveY: 127 });
    match.resetPlayersForRound();
    expect(player.vehicleId).toBe(0);
    expect(match.vehicles.get(1)?.state).toMatchObject({ x: 0, z: 0, speed: 0 });
    match.teleport(player, 1.8, 0, 0);
    ask(player, { action: 'enter', vehicle: 1 });
    match.leave(player.id);
    expect(match.vehicles.get(1)?.driver).toBe(0);
  });

  it('frees the car when its driver is killed', () => {
    const { match, join, ask } = setup();
    const a = join('Ana').player;
    const b = join('Ben').player;
    match.teleport(a, 1.8, 0, 0);
    ask(a, { action: 'enter', vehicle: 1 });
    a.protectedUntilTick = 0;
    match.damage(a, 1000, b);
    expect(a.alive).toBe(false);
    expect(a.vehicleId).toBe(0);
    expect(match.vehicles.get(1)?.driver).toBe(0);
    expect(ask(a, { action: 'enter', vehicle: 1 })).toMatchObject({ reason: 'dead' });
  });
});
