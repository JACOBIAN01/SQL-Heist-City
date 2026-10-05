import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Mesh, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DEFAULT_VEHICLE_SETTINGS, SIM_DT, type GameMap } from '@heist/shared';
import { CAR_KIND, carAssetsFrom, type CarAssets } from './carAssets';
import { followAngle, TestDrive } from './TestDrive';

let cars: CarAssets;
const dir = join(__dirname, '../../public/vehicles/');

beforeAll(async () => {
  const file = readFileSync(`${dir}cars.glb`);
  const data = new ArrayBuffer(file.byteLength);
  new Uint8Array(data).set(file);
  cars = carAssetsFrom((await new GLTFLoader().parseAsync(data, '')).scene);
});

describe('the car file', () => {
  it('holds every car the game maps to a driving spec, under 0.5 MB', () => {
    expect([...cars.templates.keys()].sort()).toEqual(Object.keys(CAR_KIND).sort());
    const manifest = JSON.parse(readFileSync(`${dir}cars.json`, 'utf8')) as {
      cars: { id: string; tris: number }[];
    };
    expect(manifest.cars.every((c) => c.tris < 4000)).toBe(true);
    expect(readFileSync(`${dir}cars.glb`).byteLength).toBeLessThan(512 * 1024);
  });

  it('has a body and three wheels per car, wheels pivoting at their axles', () => {
    for (const template of cars.templates.values()) {
      for (const name of ['body', 'wheel_fl', 'wheel_fr', 'wheels_back'])
        expect(template.getObjectByName(`${template.name}_${name}`), name).toBeDefined();
      const fl = template.getObjectByName(`${template.name}_wheel_fl`) as Object3D;
      // Front wheels are toward −z (the car faces −z) and on the left (−x).
      expect(fl.position.z).toBeLessThan(0);
      expect(fl.position.x).toBeLessThan(0);
      expect(fl.position.y).toBeGreaterThan(0.2);
    }
  });

  it('marks the lamps so they can glow, and stores colours, not normals', () => {
    const body = cars.templates.get('Taxi')?.getObjectByName('Taxi_body') as Mesh;
    const g = body.geometry;
    expect(g.getAttribute('color')).toBeDefined();
    expect(g.getAttribute('normal')).toBeUndefined();
    const glow = Array.from(g.getAttribute('_glow').array as ArrayLike<number>);
    expect(glow.some((v) => v === 1)).toBe(true);
    expect(glow.some((v) => v === 0)).toBe(true);
  });
});

describe('CarModel', () => {
  it('shares one flat-shaded material whose lamps glow with the night', () => {
    const a = cars.create('Taxi');
    const b = cars.create('SUV');
    const mats = new Set<unknown>();
    for (const car of [a, b])
      car.object.traverse((n) => (n as Mesh).isMesh && mats.add((n as Mesh).material));
    expect(mats.size).toBe(1);
    expect(cars.material.flatShading).toBe(true);
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <emissivemap_fragment>',
    };
    cars.material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.uNightGlow).toBe(cars.nightGlow);
    expect(shader.fragmentShader).toContain('vColor.rgb * vGlow');
  });

  it('places the car, steers the front wheels and rolls all of them', () => {
    const car = cars.create('NormalCar1');
    expect(car.wheelCount).toBe(3);
    car.pose({ x: 5, z: -3, yaw: 1, steer: 0.4 }, 0.5);
    expect(car.object.position.toArray()).toEqual([5, 0, -3]);
    expect(car.object.rotation.y).toBe(1);
    const fl = car.object.getObjectByName('NormalCar1_wheel_fl') as Object3D;
    const back = car.object.getObjectByName('NormalCar1_wheels_back') as Object3D;
    expect(fl.rotation.y).toBe(0.4);
    expect(back.rotation.y).toBe(0);
    expect(back.rotation.x).toBeLessThan(0); // rolled forward
  });

  it('refuses a model that is not in the file', () => {
    expect(() => cars.create('Tank')).toThrow(/Tank/);
  });
});

describe('TestDrive', () => {
  it('drives with the shared physics and draws in between steps', () => {
    const map: GameMap = { id: 'open', halfSize: 200, boxes: [], spawns: [] };
    const drive = new TestDrive(
      cars.create('SportsCar'),
      map,
      DEFAULT_VEHICLE_SETTINGS.kinds.sports,
      0,
      0,
      0,
    );
    for (let i = 0; i < 60; i++) drive.step({ throttle: 1, steer: 0, handbrake: false }, SIM_DT);
    const before = drive.state.z;
    drive.step({ throttle: 1, steer: 0, handbrake: false }, SIM_DT);
    const half = drive.draw(0.5);
    expect(half.z).toBeLessThan(before);
    expect(half.z).toBeGreaterThan(drive.state.z);
    expect(drive.model.object.position.z).toBe(half.z);
  });
});

describe('followAngle', () => {
  it('closes part of the gap each frame, the short way round', () => {
    expect(followAngle(0, 1, 1 / 60, 5)).toBeGreaterThan(0);
    expect(followAngle(0, 1, 1 / 60, 5)).toBeLessThan(0.1);
    // From just under +π to just over −π is a small step across the seam, not a full turn.
    const across = followAngle(3.1, -3.1, 1, 50);
    expect(Math.abs(Math.atan2(Math.sin(across + 3.1), Math.cos(across + 3.1)))).toBeLessThan(0.01);
    expect(followAngle(2, 2, 1, 5)).toBe(2);
  });
});
