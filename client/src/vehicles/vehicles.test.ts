import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Mesh, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CAR_KIND, carAssetsFrom, type CarAssets } from './carAssets';
import { followAngle } from './PredictedVehicle';

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

describe('car paint', () => {
  it('paints a car with a shared per-colour material that keeps the night glow, and unpaints it', () => {
    const car = cars.create('Taxi');
    const red = cars.painted(0xc0392b);
    expect(cars.painted(0xc0392b)).toBe(red); // one material per colour
    expect(red.color.getHex()).toBe(0xc0392b);
    expect(red).not.toBe(cars.material);
    const materials = () => {
      const set = new Set<unknown>();
      car.object.traverse((n) => (n as Mesh).isMesh && set.add((n as Mesh).material));
      return set;
    };
    car.setPaint(red);
    expect([...materials()]).toEqual([red]);
    car.setPaint(undefined);
    expect([...materials()]).toEqual([cars.material]);
    // The paint is the same shader as the factory material, so lamps still glow.
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <emissivemap_fragment>',
    };
    red.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.uNightGlow).toBe(cars.nightGlow);
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
    expect(shader.fragmentShader).toContain('vGlow * (0.2 + 2.5 * uNightGlow)');
  });

  it('places the car, steers the front wheels and rolls all of them', () => {
    const car = cars.create('NormalCar1');
    expect(car.wheelCount).toBe(3);
    car.pose({ x: 5, z: -3, yaw: 1, steer: 0.4 }, 0.5);
    expect(car.isMoving).toBe(true);
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

describe('followAngle', () => {
  it('closes part of the gap each frame, the short way round', () => {
    expect(followAngle(0, 1, 1 / 60, 5)).toBeGreaterThan(0);
    expect(followAngle(0, 1, 1 / 60, 5)).toBeLessThan(0.1);
    const across = followAngle(3.1, -3.1, 1, 50);
    expect(Math.abs(Math.atan2(Math.sin(across + 3.1), Math.cos(across + 3.1)))).toBeLessThan(0.01);
  });
});

describe('a parked car', () => {
  it('is one merged mesh, and switches to the jointed car once it moves', () => {
    const car = cars.create('Taxi');
    car.pose({ x: 0, z: 0, yaw: 0, steer: 0 }, 0, false);
    expect(car.isMoving).toBe(false);
    const visibleMeshes: Mesh[] = [];
    car.object.traverseVisible((n) => (n as Mesh).isMesh && visibleMeshes.push(n as Mesh));
    expect(visibleMeshes).toHaveLength(1);
    // The merged mesh has every part: as many triangles as body and wheels together.
    const parts = cars.templates.get('Taxi');
    let tris = 0;
    parts?.traverse((n) => {
      const g = (n as Mesh).geometry;
      if ((n as Mesh).isMesh) tris += (g.index?.count ?? 0) / 3;
    });
    expect((visibleMeshes[0]?.geometry.index?.count ?? 0) / 3).toBe(tris);
    car.pose({ x: 0, z: -1, yaw: 0, steer: 0 }, 1);
    expect(car.isMoving).toBe(true);
  });
});
