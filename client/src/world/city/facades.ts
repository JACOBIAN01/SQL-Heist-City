import type { Rect, Rng } from '@heist/shared';
import { turnAlong, turnNormal, type Placement, type Turn } from './plan';

/** Kit pieces a facade style is built from (all 2 m wide, 3 m tall, facing +z). */
export interface FacadeStyle {
  readonly wall: string;
  readonly window: string;
  readonly groundWall: string;
  /** Ground-floor shop window. */
  readonly shop: string;
  /** Runs along the top edge of the roof. */
  readonly cornice: string;
  /** Window rhythms this style may use: W window, P plain wall. Heavy windows get sparser ones. */
  readonly rhythms: readonly string[];
  /** Texture layer a far-away box of this building is painted with. */
  readonly massLayer: string;
}

/**
 * The facade grammar's vocabulary. Window pieces are the lightest of the kit
 * that still read as windows (150–210 triangles, against 6–34 for a plain
 * wall), which is why only street sides get them, and never every module.
 */
export const FACADE_STYLES: Readonly<Record<'brick' | 'metal' | 'trim', FacadeStyle>> = {
  brick: {
    wall: 'Brick_Plain_3',
    window: 'Brick_Window_Square_Single',
    groundWall: 'Brick_BottomTrim',
    shop: 'Trim_FirstFloor_Window_001',
    cornice: 'Cornice_Brick_Center',
    rhythms: ['WP', 'WWP'],
    massLayer: 'brick',
  },
  metal: {
    wall: 'Metal_Plain_3',
    window: 'Metal_FullWindow',
    groundWall: 'Metal_FirstFloor_Wall',
    shop: 'Metal_FirstFloor_Window',
    cornice: 'Cornice_Metal_Center',
    rhythms: ['WP', 'WWP'],
    massLayer: 'concrete',
  },
  trim: {
    wall: 'Trim_Plain_3',
    // The kit's own trim window and cornice are 556 and 112 triangles; these read the same at street distance.
    window: 'Metal_FullWindow',
    groundWall: 'Trim_FirstFloor_Wall',
    shop: 'Trim_FirstFloor_Window_001',
    cornice: 'Cornice_Metal_Center',
    rhythms: ['WP', 'WPP'],
    massLayer: 'trim',
  },
};

export type StyleId = keyof typeof FACADE_STYLES;
export const STYLE_IDS = Object.keys(FACADE_STYLES) as StyleId[];

const MODULE = 2;

/** One side of a building, as the grammar sees it. */
export interface FacadeSide {
  readonly turn: Turn;
  /** Faces a street: windows and shop fronts. Otherwise (alleys, yards) plain walls. */
  readonly street: boolean;
  /** Storeys hidden behind a taller-or-equal neighbour sharing this wall (none are built). */
  readonly hiddenStoreys: number;
  /** Ground-floor stretch to leave open, measured along the side from its start, e.g. a bank door. */
  readonly gap?: { readonly from: number; readonly to: number };
}

export interface FacadeBuilding {
  readonly rect: Rect;
  readonly storeys: number;
  readonly storeyHeight: number;
  readonly style: FacadeStyle;
  /** Push the facade out from the footprint, m (a bank's collider walls stand half outside it). */
  readonly outset?: number;
  readonly sides: readonly FacadeSide[];
}

/** Start corner and length of a building side, walking the way the turned piece's +x points. */
export function sideOf(rect: Rect, turn: Turn): { x: number; z: number; length: number } {
  switch (turn) {
    case 0:
      return { x: rect.minX, z: rect.maxZ, length: rect.maxX - rect.minX };
    case 1:
      return { x: rect.maxX, z: rect.maxZ, length: rect.maxZ - rect.minZ };
    case 2:
      return { x: rect.maxX, z: rect.minZ, length: rect.maxX - rect.minX };
    case 3:
      return { x: rect.minX, z: rect.minZ, length: rect.maxZ - rect.minZ };
  }
}

/**
 * Places a building's facade pieces: per side, per storey, one 2 m module
 * at a time, then a cornice along the roof line.
 * Pattern: Interpreter (a tiny grammar: style + rhythm → pieces) — Why: every
 * building in the city comes from a few rules and a seed, so the city looks
 * varied without anyone authoring 100 facades, and art changes are one table.
 */
export function placeFacade(b: FacadeBuilding, rng: Rng): Placement[] {
  const out: Placement[] = [];
  const rhythm = rng.pick(b.style.rhythms);
  const interiors = ['interior1', 'interior2', 'interiorDark'];
  for (const side of b.sides) {
    if (side.hiddenStoreys >= b.storeys) continue;
    const { x, z, length } = sideOf(b.rect, side.turn);
    const along = turnAlong(side.turn);
    const out_ = turnNormal(side.turn);
    const push = b.outset ?? 0;
    const modules = Math.floor(length / MODULE);
    for (let m = 0; m < modules; m++) {
      const at = MODULE * m + MODULE / 2;
      const px = x + along.x * at + out_.x * push;
      const pz = z + along.z * at + out_.z * push;
      for (let s = side.hiddenStoreys; s < b.storeys; s++) {
        const inGap =
          s === 0 && side.gap !== undefined && at + 1 > side.gap.from && at - 1 < side.gap.to;
        if (inGap) continue;
        const window = side.street && rhythm[m % rhythm.length] === 'W';
        const piece =
          s === 0
            ? side.street && window
              ? b.style.shop
              : b.style.groundWall
            : window
              ? b.style.window
              : b.style.wall;
        out.push({
          piece,
          x: px,
          y: s * b.storeyHeight,
          z: pz,
          turn: side.turn,
          ...(window ? { interior: rng.weightedPick(interiors, [4, 3, 2]) } : {}),
        });
      }
      out.push({
        piece: b.style.cornice,
        x: px,
        y: b.storeys * b.storeyHeight,
        z: pz,
        turn: side.turn,
      });
    }
  }
  return out;
}
