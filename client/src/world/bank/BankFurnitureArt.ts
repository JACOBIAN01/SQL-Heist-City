import { Group } from 'three';
import { BANK_LAYOUTS, placeFurniture, type GameMap } from '@heist/shared';
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
    root.add(bank);
  }
  return root;
}
