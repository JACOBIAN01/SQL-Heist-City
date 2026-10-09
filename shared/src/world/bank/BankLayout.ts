import type { AnchorKind, MapBoxKind } from '../map';

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

export type Heading = '+x' | '-x' | '+z' | '-z';

/**
 * A straight flight from `storey` up to the next one. The low end is where
 * you start climbing; the storey above gets a matching hole in its floor.
 */
export interface StairSpec {
  /** The storey the flight starts on (arrives on storey + 1). */
  readonly storey: number;
  /** Centre of the flight's footprint. */
  readonly x: number;
  readonly z: number;
  readonly width: number;
  /** Direction of travel, up the stairs. */
  readonly heading: Heading;
  readonly steps: number;
  /** Horizontal depth of one step, m. */
  readonly tread: number;
}

/** A usable spot inside the bank (local coordinates). */
export interface AnchorSpec {
  /** Unique within the bank; the map id becomes `<bank id>:<id>`. */
  readonly id: string;
  readonly kind: AnchorKind;
  readonly storey: number;
  readonly x: number;
  readonly z: number;
  /** Defaults to 1.5 m. */
  readonly radius?: number;
}

/**
 * A run of fittings along a vault wall: `x`, `z` is the middle of the run on
 * the wall's inner face; it stands `depth` m out from the wall toward
 * `facing` and runs along the wall for `width` m.
 */
export interface WallRun {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly facing: Heading;
}

/** What fills a vault room (11.4). Both kinds are solid: you cannot walk into them. */
export interface VaultFittings {
  /** Walls of safe-deposit boxes. */
  readonly depositBoxes?: readonly WallRun[];
  /** Shelves stacked with bundles of cash. */
  readonly cashShelves?: readonly WallRun[];
}

/** How far fittings stand out from their wall, and how tall they are. */
export const FITTING_DEPTH = 0.35;
export const FITTING_HEIGHT = 2.2;

/** A vault room's door and console. The door is a blocker until the vault opens. */
export interface VaultSpec {
  readonly id: string;
  readonly storey: number;
  /** The door, as a block in the doorway (bottom is relative to the storey floor). */
  readonly door: {
    readonly x: number;
    readonly z: number;
    readonly width: number;
    readonly depth: number;
    readonly height: number;
  };
  /** Where players stand to work the locks. */
  readonly console: Point2;
  /** Where cash bags appear once the vault is open. */
  readonly loot: readonly Point2[];
  /** Deposit boxes and cash shelves along its walls. */
  readonly fittings?: VaultFittings;
}

/**
 * A piece of furniture (an interior-kit piece, see furniturePieces.ts). Its
 * art is drawn by the client; a `solid` piece also blocks movement and shots
 * with its footprint, so it is part of the shared geometry.
 */
export interface FurnitureSpec {
  readonly piece: string;
  readonly storey: number;
  /** Centre of the piece (its own origin; a single door's is its hinge), local coordinates. */
  readonly x: number;
  readonly z: number;
  /** Which way its front faces. Defaults to +z (toward the street). */
  readonly facing?: Heading;
  /** Size multiplier on the built piece. Defaults to 1. */
  readonly scale?: number;
  /** Height above the storey floor (a lamp on a desk); hanging lights hang from the ceiling. */
  readonly y?: number;
  /** Blocks movement and bullets. Decoration (plants, carpets, lights) is not solid. */
  readonly solid?: boolean;
}

/** What a floor is laid with (art only: every finish walks the same). */
export type FloorFinish = 'marble' | 'wood' | 'carpet' | 'tile' | 'steel';
/** What the walls of a room are clad in. */
export type WallFinish = 'plaster' | 'panel' | 'steel' | 'marble';
/** What a bank's outside walls are clad in (art only): plain stone up to white marble. */
export type Cladding = 'stone' | 'sandstone' | 'granite' | 'limestone' | 'whitestone';

/**
 * A room's finishes (art only). Rooms are rectangles on one storey; where
 * none is given a storey uses its default (marble on the ground floor,
 * carpet above, plaster walls).
 */
export interface RoomSpec {
  readonly storey: number;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly floor?: FloorFinish;
  readonly walls?: WallFinish;
}

/**
 * Fittings the interior kit has no piece for, built in code by the client
 * (11.5). Art only: they never collide, so they cannot change play.
 * `tellerScreen`: glass and brass over a counter, with a gap at counter
 * height to pass things through. `queuePosts`: brass posts joined by a rope.
 * `x`, `z` is the middle of the run; `facing` gives its direction (a run
 * facing ±z lies along x, one facing ±x along z).
 */
export interface FixtureSpec {
  readonly kind: 'tellerScreen' | 'queuePosts';
  readonly storey: number;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly facing: Heading;
  /** Height of the counter the screen stands on, m (tellerScreen). Defaults to 1.1. */
  readonly base?: number;
}

/**
 * What stands on a bank's street facade (11.5–11.7), art only: it may reach
 * past the footprint (a cornice, a plaque, an ATM) because nothing collides.
 * `x` values run along the front, 0 at the middle, east positive.
 */
export interface FacadeSpec {
  /** Engaged columns against the wall. */
  readonly pilasters?: readonly number[];
  /** A cash machine on the wall, at this x. */
  readonly atm?: number;
  /** Lanterns at the door; they glow at night. */
  readonly lamps?: readonly number[];
  /** A plaque with the bank's name over the door. */
  readonly sign?: boolean;
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
  /** Flights between storeys. Floors above the ground get slabs with holes where these arrive. */
  readonly stairs?: readonly StairSpec[];
  /** Elevators, the vault console… */
  readonly anchors?: readonly AnchorSpec[];
  readonly vaults?: readonly VaultSpec[];
  /** Furniture and fittings (Phase 11): the realistic interior. */
  readonly furniture?: readonly FurnitureSpec[];
  /** The street front: pilasters, plaque, lamps, ATM (Phase 11.7). */
  readonly facade?: FacadeSpec;
  /** Teller screens and queue posts (Phase 11.5). */
  readonly fixtures?: readonly FixtureSpec[];
  /** The outside walls' stone. Defaults to plain stone; richer tiers are clad in finer stone. */
  readonly cladding?: Cladding;
  /** Floor and wall finishes by room (Phase 11.3). */
  readonly rooms?: readonly RoomSpec[];
}

export const DEFAULT_ANCHOR_RADIUS = 1.5;

export const EXTERIOR_THICKNESS = 0.4;
export const DEFAULT_WALL_THICKNESS = 0.2;
export const ROOF_THICKNESS = 0.3;
export const SLAB_THICKNESS = 0.3;
/** Tallest single step the layout may use (movement.stepHeight is 0.35). */
export const MAX_STEP_RISE = 0.3;
