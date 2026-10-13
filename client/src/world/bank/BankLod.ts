import type { Object3D } from 'three';
import type { BankLayout, PlacedBank } from '@heist/shared';

/**
 * How much of a bank's inside is drawn. Detail is for whoever can see it:
 * nobody beyond `range` metres of the building, and from the street only the
 * ground floor (through the door). Inside, the player's own storey and the
 * one above and below it, which is all the stairwells and the lift show.
 */
export const BANK_LOD = {
  /** Metres from the footprint beyond which no interior is drawn. */
  range: 40,
  /** Storeys above and below the player's that are still drawn inside. */
  storeysAround: 1,
} as const;

interface Entry {
  readonly group: Object3D;
  /** The storey it belongs to; none for a bank's outside. */
  readonly storey: number | undefined;
  /** Small detail (windows, desks, vaults): drawn only on the player's own storey. */
  readonly fine: boolean;
  readonly bank: { rect: Rect; height: number };
}

interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Switches the interior groups of every bank on and off by distance and
 * storey. The art builders tag each group with `userData.bankTier` and
 * `userData.storey`; `add` finds them under any root, so furniture that
 * arrives late (the kit loads after the first frame) joins when it comes.
 * Pattern: Level of detail — Why: five banks of furniture, windows and
 * vaults are far more than a frame can afford, but only one is ever near.
 */
export class BankLod {
  private readonly banks = new Map<number, { rect: Rect; height: number }>();
  private readonly entries: Entry[] = [];

  constructor(
    banks: readonly PlacedBank[],
    layouts: ReadonlyMap<number, BankLayout>,
    private readonly settings: { range: number; storeysAround: number } = BANK_LOD,
  ) {
    for (const site of banks) {
      const layout = layouts.get(site.tier);
      if (!layout) continue;
      this.banks.set(site.tier, {
        height: layout.storeyHeight,
        rect: {
          minX: site.x - layout.width / 2,
          maxX: site.x + layout.width / 2,
          minZ: site.z - layout.depth / 2,
          maxZ: site.z + layout.depth / 2,
        },
      });
    }
  }

  /** Registers every tagged group under `root`. */
  add(root: Object3D): void {
    root.traverse((o) => {
      const { bankTier, storey, fine, exterior } = o.userData as {
        bankTier?: number;
        storey?: number;
        fine?: boolean;
        exterior?: boolean;
      };
      if (bankTier === undefined || (storey === undefined && !exterior)) return;
      const bank = this.banks.get(bankTier);
      if (bank && !this.entries.some((e) => e.group === o))
        this.entries.push({ group: o, storey, fine: fine === true, bank });
    });
  }

  /** Shows what a player at (x, y, z) can see of each bank's inside. */
  update(x: number, y: number, z: number): void {
    for (const e of this.entries) {
      const r = e.bank.rect;
      const dx = Math.max(r.minX - x, 0, x - r.maxX);
      const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
      const distance = Math.hypot(dx, dz);
      const inside = distance <= 0.5;
      const here = Math.max(0, Math.floor((y + 0.6) / e.bank.height));
      if (e.storey === undefined) {
        // The street front: always there from outside, and from the ground floor looking out.
        e.group.visible = !inside || here === 0;
      } else if (distance > this.settings.range) e.group.visible = false;
      else if (!inside)
        e.group.visible = e.storey === 0; // from the street: the ground floor, through the door
      else {
        const around = e.fine ? 0 : this.settings.storeysAround;
        e.group.visible = Math.abs(e.storey - here) <= around;
      }
    }
  }

  /** Groups registered, for tests and the perf overlay. */
  get size(): number {
    return this.entries.length;
  }
}
