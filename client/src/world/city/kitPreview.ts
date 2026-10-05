import { Group, Vector3, type Object3D } from 'three';

/** Anything with sized pieces: the city kit, the bank furniture. */
export interface PreviewSource {
  info(id: string): { readonly min: readonly number[]; readonly size: readonly number[] };
  createPiece(id: string): Object3D;
}

const GAP = 1.5;

/**
 * Lays pieces out in rows (largest footprint first, so streets and facades sit
 * apart from small props), each piece's corner at its grid cell. For the kit
 * preview page.
 */
export function layoutPreview(
  kit: PreviewSource,
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
    const [minX = 0, minY = 0, minZ = 0] = min;
    const [sizeX = 0, sizeY = 0, sizeZ = 0] = size;
    if (x > 0 && x + sizeX > rowWidth) {
      x = 0;
      z += rowDepth + GAP;
      rowDepth = 0;
    }
    const piece = kit.createPiece(id);
    piece.position.set(x - minX, -minY + (sizeY < 0.05 ? 0.02 : 0), z - minZ);
    root.add(piece);
    x += sizeX + GAP;
    width = Math.max(width, x);
    rowDepth = Math.max(rowDepth, sizeZ);
  }
  return { root, extent: new Vector3(width, 0, z + rowDepth) };
}

function footprint(kit: PreviewSource, id: string): number {
  const [x = 0, , z = 0] = kit.info(id).size;
  return x * z;
}
