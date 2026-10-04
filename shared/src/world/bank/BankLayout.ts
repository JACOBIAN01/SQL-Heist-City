import type { MapBoxKind } from '../map';

/**
 * Bank layout format (docs/city-kit.md rule 1): a bank is described once, as
 * logical walls and blocks in metres, and compiled into the colliders that
 * both server and client use. Art (kit pieces) is derived from the same
 * description on the client, so changing how a bank looks never changes how
 * it plays. Coordinates are local: the footprint is centred on (0, 0), width
 * runs along x, depth along z, and the street entrance is on the +z side.
 */

/** A gap in a wall: a door (sill 0) or a window/pass-through (sill > 0). */
export interface Opening {
  /** Distance from the wall's start to the opening's near edge, m. */
  readonly at: number;
  readonly width: number;
  readonly height: number;
  /** Height of the opening's bottom edge above the storey floor, m. */
  readonly sill?: number;
}

export interface Point2 {
  readonly x: number;
  readonly z: number;
}

/** An interior wall; axis-aligned (from and to share x or z). */
export interface WallSpec {
  readonly from: Point2;
  readonly to: Point2;
  readonly thickness?: number;
  readonly openings?: readonly Opening[];
}

/** A solid block such as a teller counter. `bottom` is relative to the storey floor. */
export interface BlockSpec {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly bottom?: number;
  readonly kind?: MapBoxKind;
}

/** What is inside one storey (the outer shell is generated from the footprint). */
export interface FloorPlan {
  readonly walls: readonly WallSpec[];
  readonly blocks: readonly BlockSpec[];
}

export interface BankLayout {
  readonly id: string;
  readonly name: string;
  /** Difficulty tier 1–5 (docs/gameplay.md). Decides the vault's lock tiers. */
  readonly tier: number;
  /** Footprint, m. Multiples of 2 so kit pieces line up. */
  readonly width: number;
  readonly depth: number;
  readonly storeys: number;
  /** Floor to floor, m. 3 matches the kit module. */
  readonly storeyHeight: number;
  /** Street door on the +z facade, ground storey only. */
  readonly entrance: { readonly x: number; readonly width: number; readonly height: number };
  /** Interior per storey; index 0 is the ground floor. Missing storeys are empty. */
  readonly floors: readonly FloorPlan[];
}

export const EXTERIOR_THICKNESS = 0.4;
export const DEFAULT_WALL_THICKNESS = 0.2;
export const ROOF_THICKNESS = 0.3;
