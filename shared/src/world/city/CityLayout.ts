import type { CitySettings } from '../../config/city';
import type { ParkedCar, SpawnPoint } from '../map';

/**
 * The city as data (docs/city-kit.md rule 1): streets, blocks, lots and the
 * special sites. Generated from a seed, it is the single source of truth for
 * both physics (compileCity → GameMap) and art (the client's facade grammar).
 * World axes: x east, z south (+z is "front" for every lot: entrances face it).
 */
export interface Rect {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export type LotUse = 'building' | 'plaza' | 'bank' | 'safehouse' | 'hospital';

export interface Lot {
  readonly rect: Rect;
  readonly use: LotUse;
  /** Buildings on the lot, side by side (none for a plaza or safehouse). */
  readonly buildings: readonly CityBuilding[];
}

/** A solid shell: only banks have interiors. */
export interface CityBuilding {
  readonly rect: Rect;
  readonly storeys: number;
  /** Set on a district's landmark: what it is called (Phase 30.1). */
  readonly landmark?: string;
}

export interface CityBlock {
  /** Grid position, 0-based from the north-west corner. */
  readonly ix: number;
  readonly iz: number;
  /** Kerb line: the block including its sidewalk. */
  readonly outer: Rect;
  /** Inside the sidewalk: where lots are. */
  readonly inner: Rect;
  readonly lots: readonly Lot[];
  /** The district this block belongs to (an id in `CityLayout.districts`). */
  readonly district: string;
}

export interface BankSite {
  /** `bank-<tier>`; matches the BankLayout id that will stand here. */
  readonly id: string;
  readonly tier: number;
  /** Centre of the bank's footprint; its entrance faces +z onto the sidewalk. */
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
}

export interface SafehouseSite {
  readonly id: string;
  /** Where the banking pad is. */
  readonly x: number;
  readonly z: number;
}

export interface HospitalSite {
  readonly building: Rect;
  /** Beds in the forecourt, facing the street. */
  readonly beds: readonly SpawnPoint[];
}

/** A district as the map shows it (Phase 30.1). */
export interface DistrictSite {
  readonly id: string;
  readonly name: string;
  readonly tint: number;
  readonly facades: readonly string[];
  /** Where its name is written: the middle of its blocks. */
  readonly x: number;
  readonly z: number;
  readonly landmark?: { readonly name: string; readonly x: number; readonly z: number };
  /** Open ground in the district where its job board stands (Phase 30.6). */
  readonly board: { readonly x: number; readonly z: number };
}

export interface CityLayout {
  readonly settings: CitySettings;
  /** The city spans [-halfSize, halfSize] on x and z, outer street included. */
  readonly halfSize: number;
  /** Street centre lines: x of each north–south street, z of each east–west street. */
  readonly streetLinesX: readonly number[];
  readonly streetLinesZ: readonly number[];
  readonly blocks: readonly CityBlock[];
  readonly districts: readonly DistrictSite[];
  readonly banks: readonly BankSite[];
  readonly safehouses: readonly SafehouseSite[];
  readonly hospital: HospitalSite;
  /** Where new players start: on the streets, facing along them. */
  readonly spawns: readonly SpawnPoint[];
  /** Cars along the kerbs, facing the way traffic would go on that side. */
  readonly parkedCars: readonly ParkedCar[];
}
