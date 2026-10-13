import type { Scene } from 'three';
import type { Group } from 'three';
import type { BagView } from '@heist/shared';
import { createCashBag } from '../entities/CashBag';
import { createCashStack } from '../entities/CashStack';

/** Bags lying in the world, bobbing gently so they catch the eye, and loose cash lying still on desks. */
export class LootRenderer {
  private readonly bags = new Map<number, { mesh: Group; baseY: number; loose: boolean }>();

  constructor(private readonly scene: Scene) {}

  get count(): number {
    return this.bags.size;
  }

  apply(add: readonly BagView[], remove: readonly number[]): void {
    for (const id of remove) {
      const bag = this.bags.get(id);
      if (!bag) continue;
      this.scene.remove(bag.mesh);
      this.bags.delete(id);
    }
    for (const b of add) {
      if (this.bags.has(b.id)) continue;
      const loose = b.loose === true;
      // Loose office cash is a small still pile on a desk; a bag is bigger the more it holds.
      const mesh = loose ? createCashStack() : createCashBag();
      if (!loose) mesh.scale.setScalar(1 + Math.min(1, b.amount / 100_000));
      mesh.position.set(b.x, b.y, b.z);
      if (loose) mesh.rotation.y = (b.id * 1.7) % (Math.PI * 2);
      this.scene.add(mesh);
      this.bags.set(b.id, { mesh, baseY: b.y, loose });
    }
  }

  /** Where each bag lies, for the minimap (loose office cash is left off: too small to mark). */
  *positions(): IterableIterator<{ id: number; x: number; z: number }> {
    for (const [id, { mesh, loose }] of this.bags)
      if (!loose) yield { id, x: mesh.position.x, z: mesh.position.z };
  }

  update(seconds: number): void {
    for (const { mesh, baseY, loose } of this.bags.values()) {
      if (loose) continue; // lies still on its desk
      mesh.position.y = baseY + 0.12 + Math.sin(seconds * 2 + baseY + mesh.position.x) * 0.06;
      mesh.rotation.y = seconds * 0.8;
    }
  }
}
