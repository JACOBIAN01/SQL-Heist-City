import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BANK_LAYOUTS, mapById } from '@heist/shared';
import { CityKit, piecesFromScene } from './CityKit';
import { createCityArt, distanceToRect, DEFAULT_STREAM } from './CityRenderer';
import { parseKitManifest } from './kitManifest';
import { createKitMaterials, layersTexture } from './kitMaterials';
import { planOutskirts } from './planCity';

const city = mapById('city')?.city;
if (!city) throw new Error('no city');
let kit: CityKit;

beforeAll(async () => {
  const dir = join(__dirname, '../../../public/city/');
  const manifest = parseKitManifest(JSON.parse(readFileSync(`${dir}kit.json`, 'utf8')));
  const file = readFileSync(dir + manifest.files.geometry);
  const data = new ArrayBuffer(file.byteLength);
  new Uint8Array(data).set(file);
  const gltf = await new GLTFLoader().parseAsync(data, '');
  const materials = createKitMaterials(layersTexture(new Uint8Array(16 * 4), 2, 4), new Texture());
  kit = new CityKit(manifest, piecesFromScene(gltf.scene), materials);
});

describe('distanceToRect', () => {
  it('is zero inside and the straight-line gap outside', () => {
    const r = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    expect(distanceToRect(r, 5, 5)).toBe(0);
    expect(distanceToRect(r, 13, 14)).toBe(5);
    expect(distanceToRect(r, -2, 5)).toBe(2);
  });
});

describe('planOutskirts', () => {
  it('rings the city with buildings outside the wall, facing in', () => {
    const plans = planOutskirts(city);
    const masses = plans.flatMap((p) => p.masses);
    expect(masses.length).toBeGreaterThan(20);
    for (const m of masses) {
      const outside =
        m.rect.maxZ <= -city.halfSize ||
        m.rect.minZ >= city.halfSize ||
        m.rect.maxX <= -city.halfSize ||
        m.rect.minX >= city.halfSize;
      expect(outside).toBe(true);
    }
    expect(planOutskirts(city)).toEqual(plans);
  });
});

describe('CityStreamer', () => {
  it('starts with the chunks around the camera in detail and the rest as impostors', () => {
    const art = createCityArt(kit, city, BANK_LAYOUTS);
    art.prime(0, 0);
    const s = art.stats;
    expect(s.chunks).toBe(25 + planOutskirts(city).length);
    expect(s.detailed).toBeGreaterThan(0);
    expect(s.detailed).toBe(s.built);
    expect(s.impostors).toBeGreaterThan(0);
    expect(s.detailed + s.impostors + s.hidden).toBe(s.chunks);
    // The city's share of draw calls, well inside the < 200 budget with ~30 players at ~3 each.
    expect(s.drawCalls).toBeLessThan(80);
  });

  it('builds detail one chunk per update while the camera crosses the city, then keeps it', () => {
    const art = createCityArt(kit, city, BANK_LAYOUTS);
    art.prime(-140, -140);
    const before = art.stats.built;
    art.update(140, 140); // jumped to the far corner: nothing there is built yet
    expect(art.stats.built).toBe(before + DEFAULT_STREAM.buildsPerUpdate);
    for (let i = 0; i < 20; i++) art.update(140, 140);
    const there = art.stats;
    expect(there.detailed).toBeGreaterThan(0);
    // Back where it started: the old detail is still built, nothing new needed.
    art.update(-140, -140);
    expect(art.stats.built).toBe(there.built);
  });

  it('does not flicker at the detail boundary (enters at detailRange, leaves past detailExit)', () => {
    const art = createCityArt(kit, city, BANK_LAYOUTS);
    const first = city.blocks[0];
    if (!first) throw new Error('no block');
    // Chunk 0-0 starts at the city's west edge (it owns the street west of its block).
    const chunkMinX = (city.streetLinesX[0] ?? 0) - city.settings.streetWidth / 2;
    const z = (first.outer.minZ + first.outer.maxZ) / 2;
    const at = (gap: number) => {
      art.update(chunkMinX - gap, z);
      return art.root.getObjectByName('chunk-0-0-detail')?.visible ?? false;
    };
    art.prime(chunkMinX - DEFAULT_STREAM.detailRange + 1, z);
    expect(at(DEFAULT_STREAM.detailRange - 1)).toBe(true);
    expect(at(DEFAULT_STREAM.detailRange + 5)).toBe(true); // between the two: stays
    expect(at(DEFAULT_STREAM.detailExit + 1)).toBe(false);
    expect(at(DEFAULT_STREAM.detailRange + 5)).toBe(false); // and stays an impostor until it is close again
  });

  it('hides chunks beyond the draw range', () => {
    const art = createCityArt(kit, city, BANK_LAYOUTS, { ...DEFAULT_STREAM, drawRange: 100 });
    art.prime(-150, -150);
    expect(art.stats.hidden).toBeGreaterThan(0);
  });
});
