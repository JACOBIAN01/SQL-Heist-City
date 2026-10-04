import { mapWithClosedDoors, type GameMap, type VaultView } from '@heist/shared';

/**
 * What the client knows about the state of the heist world: which vaults are
 * open, and so which map it collides with. The server sends vault progress on
 * join and on every change; everything that depends on it listens here.
 * Pattern: Observer — Why: movement, camera, shots and rendering each need the
 * current map but should not know about each other or about vaults.
 */
export class HeistWorld {
  private vaultViews: readonly VaultView[] = [];
  private current: GameMap;
  private readonly listeners: ((map: GameMap, closedDoorIds: ReadonlySet<string>) => void)[] = [];

  constructor(private readonly base: GameMap) {
    this.current = mapWithClosedDoors(base, base.doors?.map((d) => d.id) ?? []);
  }

  get map(): GameMap {
    return this.current;
  }

  get vaults(): readonly VaultView[] {
    return this.vaultViews;
  }

  onChange(listener: (map: GameMap, closedDoorIds: ReadonlySet<string>) => void): void {
    this.listeners.push(listener);
    listener(this.current, this.closedDoors());
  }

  /** The server's latest vault progress. */
  applyVaults(views: readonly VaultView[]): void {
    this.vaultViews = views;
    const closed = this.closedDoors();
    this.current = mapWithClosedDoors(this.base, closed);
    for (const l of this.listeners) l(this.current, closed);
  }

  /** Doors of vaults not yet fully open (until the server says otherwise, all of them are closed). */
  private closedDoors(): Set<string> {
    const open = new Set(this.vaultViews.filter((v) => v.opened >= v.locks).map((v) => v.id));
    return new Set((this.base.vaults ?? []).filter((v) => !open.has(v.id)).map((v) => v.doorId));
  }
}
