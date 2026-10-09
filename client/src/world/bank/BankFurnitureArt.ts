import { Group } from 'three';
import {
  BANK_LAYOUTS,
  ceilingHeight,
  placeFurniture,
  stairFootprint,
  type BankLayout,
  type GameMap,
  type PlacedBank,
} from '@heist/shared';
import type { InteriorKit } from './InteriorKit';

/**
 * Draws the furniture of every bank on the map with the interior kit, from
 * the same placement list the colliders come from (placeFurniture), so a
 * solid desk is exactly where it blocks you.
 */
export function buildBankFurniture(kit: InteriorKit, map: GameMap): Group {
  const root = new Group();
  root.name = 'bank-furniture';
  for (const site of map.banks ?? []) {
    const layout = BANK_LAYOUTS.get(site.tier);
    if (!layout) continue;
    const bank = new Group();
    bank.name = `bank-furniture-${layout.id}`;
    for (const p of placeFurniture(layout, site)) {
      if (!kit.has(p.piece)) continue; // a kit older than the layout: skip, the collider still holds
      const mesh = kit.create(p.piece);
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = p.yaw;
      mesh.scale.setScalar(p.scale);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      bank.add(mesh);
    }
    if (kit.has(CEILING_LIGHT))
      for (const spot of ceilingLightSpots(layout, site)) {
        const lamp = kit.create(CEILING_LIGHT);
        lamp.position.set(spot.x, spot.y, spot.z);
        lamp.matrixAutoUpdate = false;
        lamp.updateMatrix();
        bank.add(lamp);
      }
    root.add(bank);
  }
  return root;
}

/** The flat panel lamp that lights every room from the ceiling. */
export const CEILING_LIGHT = 'Light_Ceiling5';
/** Panels every this many metres. */
const LIGHT_SPACING = 4;

/**
 * Where ceiling panels go: a grid over every storey, kept off stairwells
 * (their slab has a hole) and off interior walls. Art only, so it is worked
 * out here rather than listed in every layout.
 */
export function ceilingLightSpots(
  layout: BankLayout,
  site: PlacedBank,
): { x: number; y: number; z: number }[] {
  const hw = layout.width / 2;
  const hd = layout.depth / 2;
  const spots: { x: number; y: number; z: number }[] = [];
  for (let storey = 0; storey < layout.storeys; storey++) {
    // Stairs arriving on this storey and leaving it both leave holes or headroom to keep clear.
    const stairs = (layout.stairs ?? [])
      .filter((st) => st.storey === storey || st.storey + 1 === storey)
      .map(stairFootprint);
    const walls = layout.floors[storey]?.walls ?? [];
    const y = storey * layout.storeyHeight + ceilingHeight(layout, storey);
    for (let x = -hw + LIGHT_SPACING / 2; x < hw; x += LIGHT_SPACING)
      for (let z = -hd + LIGHT_SPACING / 2; z < hd; z += LIGHT_SPACING) {
        const nearStairs = stairs.some(
          (f) => x > f.minX - 0.6 && x < f.maxX + 0.6 && z > f.minZ - 0.6 && z < f.maxZ + 0.6,
        );
        const nearWall = walls.some((w) => {
          const minX = Math.min(w.from.x, w.to.x) - 0.6;
          const maxX = Math.max(w.from.x, w.to.x) + 0.6;
          const minZ = Math.min(w.from.z, w.to.z) - 0.6;
          const maxZ = Math.max(w.from.z, w.to.z) + 0.6;
          return x > minX && x < maxX && z > minZ && z < maxZ;
        });
        if (!nearStairs && !nearWall) spots.push({ x: site.x + x, y, z: site.z + z });
      }
  }
  return spots;
}
