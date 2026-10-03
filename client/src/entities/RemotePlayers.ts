import type { Scene } from 'three';
import type { EntityState, GameEvent } from '@heist/shared';
import { Flag } from '@heist/shared';
import { SnapshotInterpolator } from '../net/SnapshotInterpolator';
import { CharacterModel, PALETTES } from './CharacterModel';
import type { AnimationThresholds } from './animation';

interface Remote {
  readonly buffer: SnapshotInterpolator;
  readonly model: CharacterModel;
  name: string;
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
    private readonly thresholds: AnimationThresholds,
  ) {}

  get count(): number {
    return this.remotes.size;
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

  /** Poses every remote at `renderTimeMs` (server time) and advances animation. */
  update(renderTimeMs: number, dtSeconds: number): void {
    for (const remote of this.remotes.values()) {
      const pose = remote.buffer.sample(renderTimeMs);
      if (!pose) continue;
      const alive = (pose.flags & Flag.Alive) !== 0;
      remote.model.object.visible = alive;
      remote.model.object.position.set(pose.x, pose.y, pose.z);
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
    const palette = PALETTES[id % PALETTES.length] ?? PALETTES[0];
    if (!palette) throw new Error('no palettes defined');
    const remote: Remote = {
      buffer: new SnapshotInterpolator(),
      model: new CharacterModel(palette, this.thresholds),
      name: this.names.get(id) ?? `Player ${id}`,
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
