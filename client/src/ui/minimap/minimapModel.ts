import { findAnchor, type GameMap, type VaultView, type WantedView } from '@heist/shared';

/** A point on the minimap, in pixels from its centre (+x right, +y down). */
export interface MapPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Where a world point lands on a minimap that turns with the player: the
 * player at the centre, facing up. `yaw` 0 faces −z, like the game.
 */
export function project(dx: number, dz: number, yaw: number, pixelsPerMetre: number): MapPoint {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  // The player's right is their forward turned clockwise: (−fz, fx).
  const ahead = dx * fx + dz * fz;
  const right = dx * -fz + dz * fx;
  return { x: right * pixelsPerMetre, y: -ahead * pixelsPerMetre };
}

/** Pulls a point that falls outside the map's circle onto its rim, so a far target still shows its direction. */
export function pinToRim(p: MapPoint, radius: number): MapPoint & { readonly pinned: boolean } {
  const d = Math.hypot(p.x, p.y);
  if (d <= radius) return { ...p, pinned: false };
  return { x: (p.x / d) * radius, y: (p.y / d) * radius, pinned: true };
}

export type MarkerKind =
  | 'bank'
  | 'safehouse'
  | 'hospital'
  | 'bag'
  /** A hidden cache the server has shown you (Phase 30.2). */
  | 'cache'
  | 'wanted'
  | 'objective'
  /** A squad-mate (Phase 27.4). */
  | 'mate'
  /** A rival the squad's lookout can see (Phase 27.3). */
  | 'foe';

export interface Marker {
  readonly kind: MarkerKind;
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Banks: tier, locks and how many are open. */
  readonly tier?: number;
  readonly locks?: number;
  readonly opened?: number;
  /** Banks: the teacher closed this one. */
  readonly closed?: boolean;
  /** Banks: a lock was cracked moments ago (the alarm is ringing). */
  readonly alert?: boolean;
  /** Wanted players: their name. */
  readonly name?: string;
  /** Kept on the rim when out of range (banks, safehouses, the wanted: where to go). */
  readonly pinned: boolean;
}

/**
 * Remembers when each vault last lost a lock, so its marker can flash while
 * the alarm rings. Progress that was already there when we joined is not news.
 */
export class VaultAlerts {
  private seen: Map<string, number> | undefined;
  private readonly crackedAt = new Map<string, number>();

  constructor(private readonly alertSeconds: number) {}

  observe(vaults: readonly VaultView[], nowSeconds: number): void {
    const before = this.seen;
    this.seen = new Map(vaults.map((v) => [v.id, v.opened]));
    if (!before) return;
    for (const v of vaults)
      // A lock cracked quietly (stealth) rings no alarm.
      if (v.opened > (before.get(v.id) ?? 0) && !v.quiet) this.crackedAt.set(v.id, nowSeconds);
  }

  isAlert(vaultId: string, nowSeconds: number): boolean {
    const at = this.crackedAt.get(vaultId);
    return at !== undefined && nowSeconds - at < this.alertSeconds;
  }
}

/**
 * Everything worth marking on the minimap: every bank with its vault's
 * progress (the bait that draws players to a heist in progress), every
 * safehouse, loose cash bags, and everyone with a bounty on them (as last
 * posted; not yourself).
 */
export function markersFor(
  map: GameMap,
  vaults: readonly VaultView[],
  bags: Iterable<{ readonly id: number; readonly x: number; readonly z: number }>,
  alerts: VaultAlerts,
  nowSeconds: number,
  wanted: readonly WantedView[] = [],
  myId = 0,
): Marker[] {
  const out: Marker[] = [];
  const views = new Map(vaults.map((v) => [v.id, v]));
  for (const vault of map.vaults ?? []) {
    const console_ = findAnchor(map, vault.consoleId);
    if (!console_) continue;
    const view = views.get(vault.id);
    out.push({
      kind: 'bank',
      id: vault.id,
      x: console_.x,
      z: console_.z,
      tier: vault.tier,
      locks: view?.locks ?? 0,
      opened: view?.opened ?? 0,
      ...(view?.closed ? { closed: true } : {}),
      alert: alerts.isAlert(vault.id, nowSeconds),
      pinned: true,
    });
  }
  for (const a of map.anchors ?? [])
    if (a.kind === 'safehouse')
      out.push({ kind: 'safehouse', id: a.id, x: a.x, z: a.z, pinned: true });
  for (const b of bags) out.push({ kind: 'bag', id: `bag-${b.id}`, x: b.x, z: b.z, pinned: false });
  for (const w of wanted)
    if (w.id !== myId)
      out.push({
        kind: 'wanted',
        id: `wanted-${w.id}`,
        x: w.x,
        z: w.z,
        name: w.name,
        pinned: true,
      });
  return out;
}

/** Squad-mates (not yourself) as map markers, with their first letter; a mate who is down is left off. */
export function mateMarkers(
  members: readonly {
    id: number;
    name: string;
    x: number;
    z: number;
    alive: boolean;
    you: boolean;
  }[],
): Marker[] {
  return members
    .filter((m) => !m.you && m.alive)
    .map((m) => ({
      kind: 'mate' as const,
      id: `mate-${m.id}`,
      x: m.x,
      z: m.z,
      name: m.name,
      pinned: false,
    }));
}

/** Rivals the squad's lookout can see, as small red markers. */
export function foeMarkers(foes: readonly { x: number; z: number }[]): Marker[] {
  return foes.map((f, i) => ({
    kind: 'foe' as const,
    id: `foe-${i}`,
    x: f.x,
    z: f.z,
    pinned: false,
  }));
}

/** Where the tutorial wants you next (pinned: it is where to go). */
export const objectiveMarker = (at: { readonly x: number; readonly z: number }): Marker => ({
  kind: 'objective',
  id: 'objective',
  x: at.x,
  z: at.z,
  pinned: true,
});

/** The hospital, where the dead wake up: the middle of the map's respawn beds (none on maps without them). */
export function hospitalMarker(map: GameMap): Marker | undefined {
  const beds = map.respawns ?? [];
  if (beds.length === 0) return undefined;
  const x = beds.reduce((a, b) => a + b.x, 0) / beds.length;
  const z = beds.reduce((a, b) => a + b.z, 0) / beds.length;
  return { kind: 'hospital', id: 'hospital', x, z, pinned: true };
}
