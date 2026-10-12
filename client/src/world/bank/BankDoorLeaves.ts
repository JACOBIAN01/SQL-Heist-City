import { Group } from 'three';
import { type BankLayout, type PlacedBank, type WallSpec } from '@heist/shared';
import type { InteriorKit } from './InteriorKit';

/** The kit's single door: hinge at its origin, the leaf running toward −x, 0.868 m wide and 2.094 m tall. */
export const DOOR_LEAF = 'Door_1';
const LEAF_WIDTH = 0.868;
const LEAF_HEIGHT = 2.094;
/** How far the leaves stand open, radians (60°): clear of the walkway, never touching it. */
const OPEN = Math.PI / 3;

/** One door leaf where it hangs. */
export interface LeafPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Rotation about y (three.js convention). */
  readonly yaw: number;
  /** Width and height scales, so a leaf fits the doorway it hangs in. */
  readonly sx: number;
  readonly sy: number;
}

/** Whether a wall opening is where a vault door stands (that door has its own art). */
function isVaultDoorway(
  layout: BankLayout,
  w: WallSpec,
  at: number,
  width: number,
  storey: number,
) {
  const alongX = w.from.z === w.to.z;
  const dir = (alongX ? Math.sign(w.to.x - w.from.x) : Math.sign(w.to.z - w.from.z)) || 1;
  const mid = (alongX ? w.from.x : w.from.z) + dir * (at + width / 2);
  return (layout.vaults ?? []).some(
    (v) =>
      v.storey === storey &&
      Math.abs((alongX ? v.door.x : v.door.z) - mid) < 0.5 &&
      Math.abs((alongX ? v.door.z : v.door.x) - (alongX ? w.from.z : w.from.x)) < 0.5,
  );
}

/**
 * Two leaves for every interior doorway, hung on its jambs and standing open,
 * alternating which way they swing. Art only: they never collide, so they
 * cannot shut anyone in or out.
 */
export function doorLeaves(layout: BankLayout, site: PlacedBank): LeafPlacement[] {
  const out: LeafPlacement[] = [];
  let n = 0;
  layout.floors.forEach((plan, storey) => {
    for (const w of plan.walls) {
      const len = Math.hypot(w.to.x - w.from.x, w.to.z - w.from.z);
      if (len === 0) continue;
      const d = { x: (w.to.x - w.from.x) / len, z: (w.to.z - w.from.z) / len };
      for (const o of w.openings ?? []) {
        if ((o.sill ?? 0) > 0 || isVaultDoorway(layout, w, o.at, o.width, storey)) continue;
        const side = n++ % 2 === 0 ? 1 : -1;
        const normal = { x: -d.z * side, z: d.x * side };
        const sx = (o.width / 2 - 0.02) / LEAF_WIDTH;
        const sy = (o.height - 0.05) / LEAF_HEIGHT;
        // Leaf A hangs on the jamb at the opening's start, leaf B on the far jamb.
        for (const [from, closed] of [
          [o.at, 1],
          [o.at + o.width, -1],
        ] as const) {
          const dir = {
            x: Math.cos(OPEN) * d.x * closed + Math.sin(OPEN) * normal.x,
            z: Math.cos(OPEN) * d.z * closed + Math.sin(OPEN) * normal.z,
          };
          out.push({
            x: site.x + w.from.x + d.x * from,
            y: storey * layout.storeyHeight,
            z: site.z + w.from.z + d.z * from,
            yaw: Math.atan2(dir.z, -dir.x),
            sx,
            sy,
          });
        }
      }
    }
  });
  return out;
}

/** Hangs the leaves of one bank with the interior kit. */
export function hangDoorLeaves(kit: InteriorKit, layout: BankLayout, site: PlacedBank): Group {
  const group = new Group();
  group.name = `bank-doors-${layout.id}`;
  if (!kit.has(DOOR_LEAF)) return group;
  for (const l of doorLeaves(layout, site)) {
    const leaf = kit.create(DOOR_LEAF);
    leaf.position.set(l.x, l.y, l.z);
    leaf.rotation.y = l.yaw;
    leaf.scale.set(l.sx, l.sy, l.sx);
    leaf.matrixAutoUpdate = false;
    leaf.updateMatrix();
    group.add(leaf);
  }
  return group;
}
