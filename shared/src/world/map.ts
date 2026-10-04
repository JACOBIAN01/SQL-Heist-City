/**
 * Static world geometry shared by server (collisions, line of sight) and
 * client (rendering). One definition means what you see is what blocks you.
 * Axis-aligned boxes only: cheap to test and enough for a blocky city.
 */
export interface Aabb {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/** Drives the client's material only; the server treats every kind the same. */
export type MapBoxKind = 'wall' | 'building' | 'interior' | 'crate' | 'step' | 'cover';

export interface MapBox extends Aabb {
  readonly kind: MapBoxKind;
}

export interface SpawnPoint {
  readonly x: number;
  readonly z: number;
  /** Facing, radians. */
  readonly yaw: number;
}

/**
 * Things a player can use by pressing F next to them. Positions are world
 * coordinates; what each kind does is decided server-side (InteractionService),
 * the client only shows a prompt when one is close.
 */
export type AnchorKind = 'elevator' | 'vault_console' | 'safehouse';

export interface MapAnchor {
  /** Unique within the map, e.g. "bank-1:lift:0". */
  readonly id: string;
  readonly kind: AnchorKind;
  readonly x: number;
  /** Floor level the anchor stands on. */
  readonly y: number;
  readonly z: number;
  /** Horizontal reach, m. */
  readonly radius: number;
  /** Bank this belongs to, when it belongs to one. */
  readonly bank?: string;
  readonly storey: number;
}

/** How far above or below an anchor a player may be and still use it (one storey is 3 m). */
export const ANCHOR_REACH_Y = 1.5;

/** A blocker that exists while its vault is closed (the vault door). Kept out of `boxes`; see world/variant.ts. */
export interface MapDoor {
  readonly id: string;
  readonly box: MapBox;
}

export interface LootSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A vault: locks guard the door, and loot appears at `loot` spots once it opens. */
export interface MapVault {
  readonly id: string;
  readonly bank: string;
  /** Bank tier 1–5: decides the lock questions and the loot. */
  readonly tier: number;
  readonly doorId: string;
  /** The anchor where players work the locks. */
  readonly consoleId: string;
  readonly loot: readonly LootSpot[];
}

export interface GameMap {
  readonly id: string;
  /** The ground plane (y = 0) spans [-halfSize, halfSize] on x and z. */
  readonly halfSize: number;
  readonly boxes: readonly MapBox[];
  readonly spawns: readonly SpawnPoint[];
  /** Where sandbox target dummies stand (optional). */
  readonly dummies?: readonly SpawnPoint[];
  /** Usable spots (elevators, vault consoles, safehouses). */
  readonly anchors?: readonly MapAnchor[];
  readonly doors?: readonly MapDoor[];
  readonly vaults?: readonly MapVault[];
}

/** Whether a body at (x, y, z) is close enough to use the anchor. */
export function anchorInReach(anchor: MapAnchor, x: number, y: number, z: number): boolean {
  return (
    Math.abs(y - anchor.y) <= ANCHOR_REACH_Y &&
    Math.hypot(x - anchor.x, z - anchor.z) <= anchor.radius
  );
}

/** The nearest anchor a body can use, if any. */
export function nearestAnchor(
  map: GameMap,
  x: number,
  y: number,
  z: number,
): MapAnchor | undefined {
  let best: MapAnchor | undefined;
  let bestDistance = Infinity;
  for (const a of map.anchors ?? []) {
    if (!anchorInReach(a, x, y, z)) continue;
    const d = Math.hypot(x - a.x, z - a.z);
    if (d < bestDistance) {
      best = a;
      bestDistance = d;
    }
  }
  return best;
}

export const findAnchor = (map: GameMap, id: string): MapAnchor | undefined =>
  map.anchors?.find((a) => a.id === id);

/** Box from its footprint centre, ground-relative bottom and size. */
export function box(
  kind: MapBoxKind,
  x: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  bottom = 0,
): MapBox {
  return {
    kind,
    minX: x - width / 2,
    maxX: x + width / 2,
    minY: bottom,
    maxY: bottom + height,
    minZ: z - depth / 2,
    maxZ: z + depth / 2,
  };
}
