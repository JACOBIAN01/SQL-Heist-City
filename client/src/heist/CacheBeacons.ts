import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Scene,
} from 'three';
import type { CachesMessage } from '@heist/shared';
import { createCashBag } from '../entities/CashBag';

const BEAM = new CylinderGeometry(0.35, 0.35, 14, 12, 1, true);
const BEAM_MATERIAL = new MeshBasicMaterial({
  color: 0xffd34d,
  transparent: true,
  opacity: 0.25,
  blending: AdditiveBlending,
  depthWrite: false,
});

/**
 * Hidden caches the server has shown this player (Phase 30.2): a cash bag with a golden beam over it
 * so it can be seen from down the street. The server decides which exist and which you may see.
 */
export class CacheBeacons {
  private readonly shown = new Map<number, { group: Group; x: number; z: number }>();

  constructor(private readonly scene: Scene) {}

  get count(): number {
    return this.shown.size;
  }

  apply(caches: CachesMessage['caches']): void {
    const keep = new Set(caches.map((c) => c.id));
    for (const [id, c] of this.shown)
      if (!keep.has(id)) {
        this.scene.remove(c.group);
        this.shown.delete(id);
      }
    for (const c of caches) {
      if (this.shown.has(c.id)) continue;
      const group = new Group();
      group.name = 'cache';
      const bag = createCashBag();
      bag.scale.setScalar(1.4);
      const beam = new Mesh(BEAM, BEAM_MATERIAL);
      beam.position.y = 7;
      group.add(bag, beam);
      group.position.set(c.x, 0, c.z);
      this.scene.add(group);
      this.shown.set(c.id, { group, x: c.x, z: c.z });
    }
  }

  /** Where each one is, for the minimap. */
  *positions(): IterableIterator<{ id: number; x: number; z: number }> {
    for (const [id, c] of this.shown) yield { id, x: c.x, z: c.z };
  }

  update(seconds: number): void {
    for (const { group } of this.shown.values()) group.rotation.y = seconds * 0.8;
  }
}
