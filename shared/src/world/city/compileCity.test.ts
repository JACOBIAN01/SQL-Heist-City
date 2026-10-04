import { describe, expect, it } from 'vitest';
import { citySettingsSchema } from '../../config/city';
import { DEFAULT_MOVEMENT_SETTINGS } from '../../config/movement';
import { SIM_DT } from '../../sim/input';
import { createBody, stepBody } from '../../sim/movement';
import { BANK_LAYOUTS, bankFootprint } from '../bank/banks';
import { BANK_1 } from '../bank/bank1';
import { anchorInReach, type GameMap, type MapBox } from '../map';
import { mapById } from '../maps';
import { cityMapById, isCityMapId } from './cityMaps';
import { compileCity, KERB_HEIGHT } from './compileCity';
import { generateCity } from './generateCity';

const map = cityMapById('city') as GameMap;
const city = map.city;
if (!city) throw new Error('city map without a layout');

const BODY_RADIUS = 0.35;
/** Whether a standing body at (x, z) on the ground would be inside a box. */
const blocked = (m: GameMap, x: number, z: number, y = 0) =>
  m.boxes.some(
    (b: MapBox) =>
      x + BODY_RADIUS > b.minX &&
      x - BODY_RADIUS < b.maxX &&
      z + BODY_RADIUS > b.minZ &&
      z - BODY_RADIUS < b.maxZ &&
      y + 1.7 > b.minY &&
      y + DEFAULT_MOVEMENT_SETTINGS.stepHeight < b.maxY,
  );

/** Walks a body facing `yaw` for `seconds`; returns where it ends up. */
function walk(m: GameMap, x: number, z: number, yaw: number, seconds: number) {
  const body = createBody(x, 0, z);
  for (let i = 0; i < seconds * 60; i++)
    stepBody(
      body,
      { seq: i, moveX: 0, moveY: 127, yaw, pitch: 0, buttons: 0, viewLagMs: 0 },
      SIM_DT,
      m,
      DEFAULT_MOVEMENT_SETTINGS,
    );
  return body;
}

describe('city map ids', () => {
  it('resolves city and city:<seed> through mapById, once per id', () => {
    expect(mapById('city')).toBe(map);
    expect(mapById('city:abc')).toBe(mapById('city:abc'));
    expect(mapById('city:abc')).not.toBe(map);
    expect(mapById('city:abc')?.id).toBe('city:abc');
  });

  it('refuses ids that are not a city or carry an unsafe seed', () => {
    for (const id of ['cityx', 'city:', 'city:a b', 'city:../x', `city:${'a'.repeat(65)}`]) {
      expect(isCityMapId(id)).toBe(false);
      expect(mapById(id)).toBeUndefined();
    }
  });

  it('regenerates to exactly the same colliders (what server and client each do)', () => {
    const settings = citySettingsSchema.parse({ seed: 'abc' });
    const fresh = compileCity('city:abc', generateCity(settings, bankFootprint), BANK_LAYOUTS);
    expect(fresh).toEqual(mapById('city:abc'));
  });
});

describe('compileCity', () => {
  it('is a heist map: unarmed start, hospital respawns, safehouses and the Bank 1 vault', () => {
    expect(map.unarmedStart).toBe(true);
    expect(map.halfSize).toBe(city.halfSize);
    expect(map.respawns).toEqual(city.hospital.beds);
    expect(map.anchors?.filter((a) => a.kind === 'safehouse').map((a) => a.id)).toEqual([
      'safehouse-1',
      'safehouse-2',
      'safehouse-3',
    ]);
    expect(map.vaults?.map((v) => v.bank)).toEqual(['bank-1']);
    expect(map.doors).toHaveLength(1);
  });

  it('stands a closed building on bank sites that have no layout yet', () => {
    const site = city.banks.find((b) => b.tier === 3);
    const shell = map.boxes.find(
      (b) =>
        b.kind === 'shell' && b.minX === (site?.x ?? 0) - (site?.width ?? 0) / 2 && b.minY === 0,
    );
    expect(shell).toBeDefined();
  });

  it('keeps the streets clear: no collider stands on the asphalt', () => {
    const streets = city.streetLinesX.flatMap((x) => [x - 5, x, x + 5]);
    for (const x of streets)
      for (let z = -city.halfSize + 1; z < city.halfSize; z += 3) {
        expect(blocked(map, x, z)).toBe(false);
        expect(blocked(map, z, x)).toBe(false);
      }
  });

  it('puts every spawn, bed and safehouse pad on free ground', () => {
    for (const p of [...map.spawns, ...(map.respawns ?? [])])
      expect(blocked(map, p.x, p.z)).toBe(false);
    for (const a of map.anchors?.filter((x) => x.kind === 'safehouse') ?? [])
      expect(blocked(map, a.x, a.z)).toBe(false);
  });

  it('has kerbs low enough to step onto', () => {
    expect(KERB_HEIGHT).toBeLessThan(DEFAULT_MOVEMENT_SETTINGS.stepHeight);
    const block = city.blocks[0];
    if (!block) throw new Error('no blocks');
    // From the street onto the sidewalk and up to the first lot, walking north.
    const end = walk(map, (block.inner.minX + block.inner.maxX) / 2, block.outer.maxZ + 2, 0, 0.8);
    expect(end.z).toBeLessThan(block.outer.maxZ - 1);
  });

  it('lets a player walk off the street, over the sidewalk and into Bank 1', () => {
    const site = city.banks.find((b) => b.tier === 1);
    const block = city.blocks.find((b) =>
      b.lots.some(
        (l) =>
          l.use === 'bank' &&
          site &&
          l.rect.minX <= site.x &&
          site.x <= l.rect.maxX &&
          l.rect.maxZ === site.z + site.depth / 2,
      ),
    );
    if (!site || !block) throw new Error('no tier-1 bank site');
    const doorX = site.x + BANK_1.entrance.x;
    const front = site.z + site.depth / 2;
    const end = walk(map, doorX, block.outer.maxZ + 4, 0, 4);
    // Across the lobby to the teller counter, 10 m inside (as on the heist lot).
    expect(end.z).toBeLessThan(front - 8);
    expect(end.y).toBeLessThan(0.1); // inside, on the lobby floor
  });

  it('can reach a safehouse pad from the street', () => {
    const pad = map.anchors?.find((a) => a.id === 'safehouse-1');
    const block = city.blocks.find((b) =>
      b.lots.some(
        (l) =>
          l.use === 'safehouse' &&
          pad &&
          l.rect.minX <= pad.x &&
          pad.x <= l.rect.maxX &&
          l.rect.minZ <= pad.z &&
          pad.z <= l.rect.maxZ,
      ),
    );
    if (!pad || !block) throw new Error('no safehouse');
    const body = walk(map, pad.x, block.outer.maxZ + 4, 0, 3);
    // Walking north from the street stops at the wall behind the pad, in reach of it.
    expect(anchorInReach(pad, body.x, body.y, body.z)).toBe(true);
  });

  it('stays a few hundred colliders, cheap for the collision grid', () => {
    expect(map.boxes.length).toBeLessThan(800);
  });
});
