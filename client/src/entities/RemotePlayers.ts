import type { Scene } from 'three';
import type { EntityState, GameEvent } from '@heist/shared';
import { Flag } from '@heist/shared';
import { SnapshotInterpolator } from '../net/SnapshotInterpolator';
import type { CharacterFactory, CharacterRig } from './CharacterRig';

interface Remote {
  readonly buffer: SnapshotInterpolator;
  readonly model: CharacterRig;
  name: string;
  /** Where the model was last drawn; shot trails start here. */
  position: { x: number; y: number; z: number };
  flags: number;
  hp: number;
  /** Snapshots since this player was last listed. */
  missed: number;
}

/** Drop a player's model after this many snapshots without them (left, or out of range in Phase 6). */
const MAX_MISSED = 20;

/**
 * Everyone else. Server states are buffered per player and drawn slightly in
 * the past, blended between real snapshots, so they move smoothly at any frame rate.
 */
export class RemotePlayers {
  private readonly remotes = new Map<number, Remote>();
  private readonly names = new Map<number, string>();

  constructor(
    private readonly scene: Scene,
    private readonly createRig: CharacterFactory,
  ) {}

  get count(): number {
    return this.remotes.size;
  }

  /** What is currently drawn, per player: for debug overlays. */
  *poses(): IterableIterator<{
    id: number;
    x: number;
    y: number;
    z: number;
    flags: number;
    hp: number;
  }> {
    for (const [id, r] of this.remotes) yield { id, ...r.position, flags: r.flags, hp: r.hp };
  }

  positionOf(id: number): { x: number; y: number; z: number } | undefined {
    return this.remotes.get(id)?.position;
  }

  nameOf(id: number): string {
    return this.remotes.get(id)?.name ?? this.names.get(id) ?? `Player ${id}`;
  }

  /** `serverTimeMs` is the snapshot's own timestamp (tick × tick length). */
  onSnapshot(serverTimeMs: number, entities: readonly EntityState[]): void {
    const seen = new Set<number>();
    for (const e of entities) {
      seen.add(e.id);
      let remote = this.remotes.get(e.id);
      if (!remote) {
        remote = this.spawn(e.id);
      }
      remote.missed = 0;
      remote.buffer.push(serverTimeMs, e);
    }
    for (const [id, remote] of this.remotes) {
      if (seen.has(id)) continue;
      if (++remote.missed > MAX_MISSED) this.remove(id);
    }
  }

  onEvent(event: GameEvent): void {
    if (event.e === 'joined') {
      this.names.set(event.id, event.name);
      const remote = this.remotes.get(event.id);
      if (remote) remote.name = event.name;
    } else if (event.e === 'left') {
      this.names.delete(event.id);
      this.remove(event.id);
    }
  }

  /**
   * Poses every remote and advances animation. `serverTimeMs` is the estimated
   * server clock now; each player is drawn `baseDelayMs` behind it, or 1.5 update
   * intervals if the server updates that player less often (distant ones), so
   * they still have two snapshots to blend between instead of freezing.
   */
  update(serverTimeMs: number, dtSeconds: number, baseDelayMs: number): void {
    for (const remote of this.remotes.values()) {
      const delay = Math.max(baseDelayMs, remote.buffer.averageIntervalMs * 1.5);
      const pose = remote.buffer.sample(serverTimeMs - delay);
      if (!pose) continue;
      const alive = (pose.flags & Flag.Alive) !== 0;
      remote.model.object.visible = alive;
      remote.model.object.position.set(pose.x, pose.y, pose.z);
      remote.position = { x: pose.x, y: pose.y, z: pose.z };
      remote.flags = pose.flags;
      remote.hp = pose.hp;
      remote.model.object.rotation.y = pose.yaw;
      remote.model.update(
        {
          speed: pose.speed,
          crouching: (pose.flags & Flag.Crouching) !== 0,
          onGround: (pose.flags & Flag.OnGround) !== 0,
        },
        dtSeconds,
      );
    }
  }

  private spawn(id: number): Remote {
    const remote: Remote = {
      buffer: new SnapshotInterpolator(),
      model: this.createRig(id),
      name: this.names.get(id) ?? `Player ${id}`,
      position: { x: 0, y: 0, z: 0 },
      flags: 0,
      hp: 0,
      missed: 0,
    };
    this.scene.add(remote.model.object);
    this.remotes.set(id, remote);
    return remote;
  }

  private remove(id: number): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    this.scene.remove(remote.model.object);
    this.remotes.delete(id);
  }
}
