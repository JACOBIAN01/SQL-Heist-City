import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Scene } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  DEFAULT_MOVEMENT_SETTINGS,
  DEFAULT_VEHICLE_SETTINGS,
  idleCommand,
  SIM_DT,
  VEHICLE_KINDS,
  createVehicle,
  quantiseVehicleState,
  stepVehicle,
  type GameMap,
  type InputCommand,
  type JsonClientMessage,
  type VehicleWire,
} from '@heist/shared';
import { LocalPlayer } from '../game/LocalPlayer';
import { carAssetsFrom, type CarAssets } from './carAssets';
import { PredictedVehicle } from './PredictedVehicle';
import { MODELS_FOR, modelFor, RemoteVehicles } from './RemoteVehicles';
import { VehicleControls } from './VehicleControls';

let cars: CarAssets;
beforeAll(async () => {
  const file = readFileSync(join(__dirname, '../../public/vehicles/cars.glb'));
  const data = new ArrayBuffer(file.byteLength);
  new Uint8Array(data).set(file);
  cars = carAssetsFrom((await new GLTFLoader().parseAsync(data, '')).scene);
});

const wire = (over: Partial<VehicleWire> = {}): VehicleWire => ({
  id: 1,
  kind: 'sedan',
  variant: 2,
  x: 0,
  z: 0,
  yaw: 0,
  steer: 0,
  speed: 0,
  driver: 0,
  ...over,
});
const open: GameMap = { id: 'open', halfSize: 300, boxes: [], spawns: [] };

describe('modelFor', () => {
  it('has a model for every kind, and every variant picks one of them', () => {
    for (const kind of VEHICLE_KINDS) {
      expect(MODELS_FOR[kind].length).toBeGreaterThan(0);
      for (let v = 0; v < 16; v++) expect(MODELS_FOR[kind]).toContain(modelFor(kind, v));
    }
    expect(modelFor('sedan', 2)).toBe('Taxi');
  });
});

describe('RemoteVehicles', () => {
  it('makes the cars it knows solid for the local player', () => {
    const v = new RemoteVehicles(new Scene(), DEFAULT_VEHICLE_SETTINGS);
    const player = new LocalPlayer(open, DEFAULT_MOVEMENT_SETTINGS, { x: 4, z: 0, yaw: 0 });
    player.cars = v.footprints();
    v.onSnapshot(0, [wire()], []); // after wiring: the view is live
    for (let i = 0; i < 120; i++) player.apply({ ...idleCommand(i, Math.PI / 2), moveY: 127 });
    expect(player.body.x).toBeGreaterThan(0.9); // stopped at the side of the car
    v.onSnapshot(50, [], [1]);
    for (let i = 0; i < 120; i++) player.apply({ ...idleCommand(i, Math.PI / 2), moveY: 127 });
    expect(player.body.x).toBeLessThan(-3); // gone: walks straight through
  });

  it('adds a model per car once the models have loaded, and removes cars that left', () => {
    const scene = new Scene();
    const v = new RemoteVehicles(scene, DEFAULT_VEHICLE_SETTINGS);
    v.onSnapshot(0, [wire()], []);
    expect(scene.children).toHaveLength(0); // no models yet
    v.setAssets(cars);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]?.name).toBe('car-Taxi');
    v.onSnapshot(50, [], [1]);
    expect(scene.children).toHaveLength(0);
    expect(v.count).toBe(0);
  });

  it('draws moving cars between snapshots, and not the one you drive', () => {
    const scene = new Scene();
    const v = new RemoteVehicles(scene, DEFAULT_VEHICLE_SETTINGS);
    v.setAssets(cars);
    v.onSnapshot(0, [wire({ speed: 10, driver: 5 })], []);
    v.onSnapshot(50, [wire({ z: -1, speed: 10, driver: 5 })], []);
    v.update(125, 100, { x: 0, z: 0 }); // 25 ms in: half-way
    const model = v.modelOf(1);
    expect(model?.object.position.z).toBeCloseTo(-0.5);
    expect(model?.isMoving).toBe(true);
    v.ownId = 1;
    v.onSnapshot(100, [wire({ z: -2, speed: 10, driver: 5 })], []);
    v.update(200, 100, { x: 0, z: 0 });
    expect(model?.object.position.z).toBeCloseTo(-0.5); // left to the prediction
  });

  it('knows who drives and which empty car is in reach', () => {
    const v = new RemoteVehicles(new Scene(), DEFAULT_VEHICLE_SETTINGS);
    v.onSnapshot(0, [wire({ id: 1, driver: 7 }), wire({ id: 2, x: 10 })], []);
    expect([...v.drivers(new Set())]).toEqual([7]);
    expect(v.freeCarNear(0.5, 0)).toBeUndefined(); // car 1 is taken
    expect(v.freeCarNear(11.8, 0)?.id).toBe(2);
    expect(v.freeCarNear(14, 0)).toBeUndefined();
  });

  it('hides cars beyond draw distance', () => {
    const v = new RemoteVehicles(new Scene(), DEFAULT_VEHICLE_SETTINGS);
    v.setAssets(cars);
    v.onSnapshot(0, [wire({ x: 150 })], []);
    v.update(100, 100, { x: 0, z: 0 });
    expect(v.modelOf(1)?.object.visible).toBe(false);
  });
});

describe('PredictedVehicle', () => {
  const spec = DEFAULT_VEHICLE_SETTINGS.kinds.sedan;
  const cmd = (seq: number): InputCommand => ({
    seq,
    moveX: 0,
    moveY: 127,
    yaw: 0,
    pitch: 0,
    buttons: 0,
    viewLagMs: 0,
  });

  it('drives at once and needs no correction when the server agrees', () => {
    const car = new PredictedVehicle(1, cars.create('Taxi'), open, spec, wire());
    for (let s = 1; s <= 30; s++) car.predict(cmd(s));
    // The server applied the first 20 commands from the same start, settling each tick as it does.
    const server = createVehicle(0, 0, 0);
    for (let s = 1; s <= 20; s++) {
      stepVehicle(server, { throttle: 1, steer: 0, handbrake: false }, SIM_DT, open, spec);
      if (s % 3 === 0) quantiseVehicleState(server);
    }
    quantiseVehicleState(server);
    car.reconcile(wire({ ...server }), 20);
    expect(car.pendingCount).toBe(10);
    expect(car.lastCorrection).toBeLessThan(0.05);
  });

  it('glides to a correction instead of jumping', () => {
    const car = new PredictedVehicle(1, cars.create('Taxi'), open, spec, wire());
    car.predict(cmd(1));
    car.reconcile(wire({ x: 1 }), 1); // the server put the car a metre to the side
    const first = car.draw(1, 1 / 60);
    expect(first.x).toBeLessThan(0.5);
    for (let i = 0; i < 120; i++) car.draw(1, 1 / 60);
    expect(car.draw(1, 1 / 60).x).toBeCloseTo(1, 2);
  });
});

describe('VehicleControls', () => {
  const setup = () => {
    const sent: JsonClientMessage[] = [];
    const view = { setPrompt: vi.fn(), toast: vi.fn() };
    const vehicles = new RemoteVehicles(new Scene(), DEFAULT_VEHICLE_SETTINGS);
    vehicles.onSnapshot(0, [wire({ id: 3 })], []);
    const controls = new VehicleControls({ send: (m) => sent.push(m), view, vehicles });
    return { sent, view, controls };
  };

  it('offers to get in next to an empty car and asks the server for that car', () => {
    const { sent, view, controls } = setup();
    controls.update(10, 0, false, true, false);
    expect(view.setPrompt).not.toHaveBeenCalled();
    controls.update(1.5, 0, false, true, false);
    expect(view.setPrompt).toHaveBeenLastCalledWith('F — get in');
    void controls.use();
    expect(sent[0]).toMatchObject({ t: 'vehicle', action: 'enter', vehicle: 3 });
  });

  it('offers to get out while driving, and shows why the server said no', async () => {
    const { sent, view, controls } = setup();
    controls.update(0, 0, true, true, false);
    expect(view.setPrompt).toHaveBeenLastCalledWith('F — get out');
    const pending = controls.use();
    const request = sent[0] as Extract<JsonClientMessage, { t: 'vehicle' }>;
    expect(request.action).toBe('exit');
    controls.handle({ t: 'vehicle_result', ref: request.ref, ok: false, reason: 'too_fast' });
    await pending;
    expect(view.toast).toHaveBeenCalledWith('Slow down to get out');
  });

  it('steps aside while a bank anchor owns the prompt, then comes back', () => {
    const { view, controls } = setup();
    controls.update(1.5, 0, false, true, true);
    expect(view.setPrompt).not.toHaveBeenCalled();
    controls.update(1.5, 0, false, true, false);
    expect(view.setPrompt).toHaveBeenLastCalledWith('F — get in');
  });
});
