import type { CashSpotSpec, FurnitureSpec, Heading } from './BankLayout';
import { FACING_YAW } from './furniture';
import { FURNITURE_PIECES, isFurniturePiece } from './furniturePieces';

/**
 * Small builders for the furniture lists in the bank layouts, so a bank's
 * rooms read as "a row of desks here, a wall of files there" instead of a
 * hundred lines of pieces. They only return data (`FurnitureSpec`s); the
 * placement, collision and drawing all happen elsewhere.
 * Pattern: Builder — Why: five banks share one vocabulary of rooms, and a
 * change to how a desk is dressed reaches all of them.
 */

/** A desk with a chair and a lamp. `side` +1 seats the worker on the +z side of the desk, −1 on the −z side. */
export function workstation(
  storey: number,
  x: number,
  z: number,
  side: 1 | -1 = 1,
): FurnitureSpec[] {
  const toward: Heading = side === 1 ? '-z' : '+z';
  return [
    { piece: 'Drawer_3', storey, x, z, facing: toward, solid: true, desk: true },
    { piece: 'Chair_3', storey, x, z: z + side, facing: toward, solid: true },
    { piece: 'Light_Desk', storey, x: x + 0.7, z, y: 0.79, facing: toward },
  ];
}

/** Workstations side by side along x. */
export function deskRow(
  storey: number,
  xs: readonly number[],
  z: number,
  side: 1 | -1 = 1,
): FurnitureSpec[] {
  return xs.flatMap((x) => workstation(storey, x, z, side));
}

/**
 * Shelving standing against a wall, one piece after another. `wall` is the
 * wall's inner face; `along` the centres of the pieces. A shelf is 0.38 m
 * deep, so it stands 0.2 m off the wall to clear its skirting.
 */
export function shelfWall(
  storey: number,
  wall: { z: number } | { x: number },
  along: readonly number[],
  piece: 'Shelf_Large' | 'Bookshelf' = 'Shelf_Large',
): FurnitureSpec[] {
  return along.map((a): FurnitureSpec => {
    if ('z' in wall) {
      const backWall = wall.z < 0; // a back wall's shelves face +z, a front wall's face −z
      return {
        piece,
        storey,
        x: a,
        z: wall.z + (backWall ? 0.2 : -0.2),
        facing: backWall ? '+z' : '-z',
        solid: true,
      };
    }
    const west = wall.x < 0;
    return {
      piece,
      storey,
      x: wall.x + (west ? 0.2 : -0.2),
      z: a,
      facing: west ? '+x' : '-x',
      solid: true,
    };
  });
}

/** A couch against a wall with a plant at each end. */
export function waitingCorner(
  storey: number,
  x: number,
  z: number,
  facing: Heading = '-z',
): FurnitureSpec[] {
  return [
    { piece: 'Couch_Medium1', storey, x, z, facing, solid: true },
    { piece: 'Houseplant_8', storey, x: x - 1.6, z, scale: 1.6 },
    { piece: 'Houseplant_8', storey, x: x + 1.6, z, scale: 1.6 },
  ];
}

/** A boardroom: a round table, chairs round it, a rug under it and a chandelier over it. */
export function boardTable(
  storey: number,
  x: number,
  z: number,
  scale = 1.8,
  chairs = 8,
): FurnitureSpec[] {
  const out: FurnitureSpec[] = [
    { piece: 'Table_RoundLarge', storey, x, z, scale, solid: true },
    { piece: 'Carpet_Round', storey, x, z, scale },
    { piece: 'Light_Chandelier', storey, x, z },
  ];
  const rx = 1.207 * scale + 0.1;
  const rz = 0.631 * scale + 0.1;
  const per = Math.max(1, Math.floor(chairs / 2));
  for (let i = 0; i < per; i++) {
    const dx = ((i + 0.5) / per - 0.5) * (rx * 1.3);
    out.push(
      { piece: 'Chair_3', storey, x: x + dx, z: z - rz, solid: true },
      { piece: 'Chair_3', storey, x: x + dx, z: z + rz, facing: '-z', solid: true },
    );
  }
  return out;
}

/** Height of the desk top the client lays over a desk cabinet (BankDecorArt). */
const DESK_TOP = 0.05;

/**
 * Loose cash on every `every`-th desk (12.1): a pile on the desk top, on the
 * side away from the monitor. Derived from the furniture, so moving a desk
 * moves its cash.
 */
export function cashOnDesks(furniture: readonly FurnitureSpec[], every = 2): CashSpotSpec[] {
  return furniture
    .filter((f) => f.desk && isFurniturePiece(f.piece))
    .filter((_, i) => i % every === 0)
    .map((f) => {
      const piece = FURNITURE_PIECES[f.piece as keyof typeof FURNITURE_PIECES];
      const scale = f.scale ?? 1;
      const width = (piece.max[0] - piece.min[0]) * scale;
      // A quarter of the desk to the piece's +x, a little to its front, turned like the desk.
      const lx = width * 0.25;
      const lz = 0.12;
      const yaw = FACING_YAW[f.facing ?? '+z'];
      return {
        storey: f.storey,
        x: f.x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
        z: f.z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
        y: piece.max[1] * scale + DESK_TOP,
      };
    });
}
