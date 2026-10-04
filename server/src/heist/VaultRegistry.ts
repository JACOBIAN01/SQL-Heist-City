import type { GameMap, VaultView } from '@heist/shared';
import { Vault } from './Vault';

/** Every vault of the map, by id and by console. */
export class VaultRegistry {
  private readonly byId = new Map<string, Vault>();

  constructor(map: GameMap, lockCount: number) {
    for (const spec of map.vaults ?? []) this.byId.set(spec.id, new Vault(spec, lockCount));
  }

  get(id: string): Vault | undefined {
    return this.byId.get(id);
  }

  byConsole(consoleId: string): Vault | undefined {
    for (const v of this.byId.values()) if (v.spec.consoleId === consoleId) return v;
    return undefined;
  }

  all(): Iterable<Vault> {
    return this.byId.values();
  }

  views(): VaultView[] {
    return [...this.byId.values()].map((v) => v.view());
  }

  /** Doors that still block: one per closed vault. */
  closedDoorIds(): string[] {
    return [...this.byId.values()].filter((v) => !v.isOpen).map((v) => v.spec.doorId);
  }
}
