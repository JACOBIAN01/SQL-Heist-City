import { Group, Vector3 } from 'three';
import type { CityKit } from './CityKit';

const GAP = 1.5;

/**
 * Lays pieces out in rows (largest footprint first, so streets and facades sit
 * apart from small props), each piece's corner at its grid cell. For the kit
 * preview page.
 */
export function layoutPreview(
  kit: CityKit,
  ids: readonly string[],
  rowWidth = 60,
): { root: Group; extent: Vector3 } {
  const root = new Group();
  const sorted = [...ids].sort(
    (a, b) => footprint(kit, b) - footprint(kit, a) || a.localeCompare(b),
  );
  let x = 0;
  let z = 0;
  let rowDepth = 0;
  let width = 0;
  for (const id of sorted) {
    const { min, size } = kit.info(id);
    if (x > 0 && x + size[0] > rowWidth) {
      x = 0;
      z += rowDepth + GAP;
      rowDepth = 0;
    }
    const piece = kit.createPiece(id);
    piece.position.set(x - min[0], -min[1] + (size[1] < 0.05 ? 0.02 : 0), z - min[2]);
    root.add(piece);
    x += size[0] + GAP;
    width = Math.max(width, x);
    rowDepth = Math.max(rowDepth, size[2]);
  }
  return { root, extent: new Vector3(width, 0, z + rowDepth) };
}

function footprint(kit: CityKit, id: string): number {
  const [x, , z] = kit.info(id).size;
  return x * z;
}
