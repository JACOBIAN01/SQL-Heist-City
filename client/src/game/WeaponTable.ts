import { DEFAULT_WEAPONS, type WeaponSpec } from '@heist/shared';

/**
 * The guns' numbers as the server last said (its defaults until then). The
 * server can retune them between rounds, so client code asks this rather
 * than reading the shared defaults.
 */
export class WeaponTable {
  private table: Readonly<Record<string, WeaponSpec>> = DEFAULT_WEAPONS;

  set(table: Readonly<Record<string, WeaponSpec>>): void {
    this.table = table;
  }

  get(id: string | undefined): WeaponSpec | undefined {
    return id ? this.table[id] : undefined;
  }
}
