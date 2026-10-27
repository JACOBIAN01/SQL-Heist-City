import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Scene,
} from 'three';
import { createCashBag } from '../entities/CashBag';

const BEAM = new CylinderGeometry(0.35, 0.35, 14, 12, 1, true);
const beamMaterial = (color: number) =>
  new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.25,
    blending: AdditiveBlending,
    depthWrite: false,
  });
const GOLD_BEAM = beamMaterial(0xffd34d);
const CYAN_BEAM = beamMaterial(0x55d6ff);
const CHIP = new Mesh(new BoxGeometry(0.5, 0.08, 0.7), new MeshBasicMaterial({ color: 0x55d6ff }));

/**
 * Hidden caches (gold bag) or data chips (cyan card, Phase 30.3) the server has shown this player (Phase 30.2): a cash bag with a golden beam over it
 * so it can be seen from down the street. The server decides which exist and which you may see.
 */
export class CacheBeacons {
  private readonly shown = new Map<number, { group: Group; x: number; z: number }>();

  constructor(
    private readonly scene: Scene,
    private readonly look: 'cache' | 'chip' = 'cache',
  ) {}

  get count(): number {
    return this.shown.size;
  }

  apply(caches: readonly { id: number; x: number; z: number }[]): void {
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
      const prop = this.look === 'chip' ? CHIP.clone() : createCashBag();
      if (this.look === 'chip') prop.position.y = 0.9;
      else prop.scale.setScalar(1.4);
      const beam = new Mesh(BEAM, this.look === 'chip' ? CYAN_BEAM : GOLD_BEAM);
      beam.position.y = 7;
      group.add(prop, beam);
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
