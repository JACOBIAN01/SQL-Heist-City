import type { BankLayout } from '../bank/BankLayout';
import { compileBankWorld } from '../bank/compileBank';
import {
  box,
  type GameMap,
  type MapAnchor,
  type MapBox,
  type MapDoor,
  type MapVault,
} from '../map';
import type { CityLayout, Rect } from './CityLayout';

/** Kerb height: the kit's sidewalk top sits 0.15 m above the asphalt. */
export const KERB_HEIGHT = 0.15;
/** A bank site with no layout yet is a closed building this many storeys tall. */
export const CLOSED_BANK_STOREYS = 3;
/** Edge of the world: tall enough that nobody jumps it. */
const BOUNDARY_HEIGHT = 8;
const SAFEHOUSE_RADIUS = 3;

const rectBox = (kind: MapBox['kind'], r: Rect, height: number, bottom = 0): MapBox => ({
  kind,
  minX: r.minX,
  maxX: r.maxX,
  minZ: r.minZ,
  maxZ: r.maxZ,
  minY: bottom,
  maxY: bottom + height,
});

/**
 * Turns a city layout into the GameMap both sides simulate on: kerbs,
 * building shells, the banks (compiled from their layouts), safehouses, the
 * hospital and street spawns. Art is not involved: the client builds that
 * separately from the same layout (8.3).
 * Pattern: Builder — Why: layout in, colliders out, by the one function the
 * server and every client run, so they cannot disagree about a wall.
 */
export function compileCity(
  id: string,
  city: CityLayout,
  bankLayouts: ReadonlyMap<number, BankLayout>,
): GameMap {
  const h = city.halfSize;
  const storey = city.settings.storeyHeight;
  const boxes: MapBox[] = [
    box('wall', 0, -h - 0.5, 2 * h + 2, BOUNDARY_HEIGHT, 1),
    box('wall', 0, h + 0.5, 2 * h + 2, BOUNDARY_HEIGHT, 1),
    box('wall', -h - 0.5, 0, 1, BOUNDARY_HEIGHT, 2 * h + 2),
    box('wall', h + 0.5, 0, 1, BOUNDARY_HEIGHT, 2 * h + 2),
  ];
  const anchors: MapAnchor[] = [];
  const doors: MapDoor[] = [];
  const vaults: MapVault[] = [];

  for (const block of city.blocks) {
    const { outer: o, inner: i } = block;
    // The sidewalk ring, as four strips: the lots inside stay at street level.
    boxes.push(
      rectBox('kerb', { ...o, maxZ: i.minZ }, KERB_HEIGHT),
      rectBox('kerb', { ...o, minZ: i.maxZ }, KERB_HEIGHT),
      rectBox('kerb', { minX: o.minX, maxX: i.minX, minZ: i.minZ, maxZ: i.maxZ }, KERB_HEIGHT),
      rectBox('kerb', { minX: i.maxX, maxX: o.maxX, minZ: i.minZ, maxZ: i.maxZ }, KERB_HEIGHT),
    );
    for (const lot of block.lots)
      for (const b of lot.buildings) boxes.push(rectBox('shell', b.rect, b.storeys * storey));
  }

  for (const site of city.banks) {
    const layout = bankLayouts.get(site.tier);
    if (!layout) {
      boxes.push(
        box('shell', site.x, site.z, site.width, CLOSED_BANK_STOREYS * storey, site.depth),
      );
      continue;
    }
    if (layout.width !== site.width || layout.depth !== site.depth)
      throw new Error(`city: ${layout.id} does not fit the site reserved for tier ${site.tier}`);
    const world = compileBankWorld(layout, { x: site.x, z: site.z });
    boxes.push(...world.boxes);
    anchors.push(...world.anchors);
    doors.push(...world.doors);
    vaults.push(...world.vaults);
  }

  for (const s of city.safehouses) {
    // A low wall behind the pad, so it reads as a place.
    boxes.push(box('building', s.x, s.z - 3.6, 6, 2.4, 0.6));
    anchors.push({
      id: s.id,
      kind: 'safehouse',
      x: s.x,
      y: 0,
      z: s.z,
      radius: SAFEHOUSE_RADIUS,
      storey: 0,
    });
  }

  return {
    id,
    halfSize: h,
    unarmedStart: true,
    boxes,
    spawns: city.spawns,
    respawns: city.hospital.beds,
    anchors,
    doors,
    vaults,
    city,
  };
}
