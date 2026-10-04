import type { Scene } from 'three';
import type { Group } from 'three';
import type { BagView } from '@heist/shared';
import { createCashBag } from '../entities/CashBag';

/** Bags lying in the world, bobbing gently so they catch the eye. */
export class LootRenderer {
  private readonly bags = new Map<number, { mesh: Group; baseY: number }>();

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
      const mesh = createCashBag();
      // Bigger piles look bigger, up to about double.
      mesh.scale.setScalar(1 + Math.min(1, b.amount / 100_000));
      mesh.position.set(b.x, b.y, b.z);
      this.scene.add(mesh);
      this.bags.set(b.id, { mesh, baseY: b.y });
    }
  }

  update(seconds: number): void {
    for (const { mesh, baseY } of this.bags.values()) {
      mesh.position.y = baseY + 0.12 + Math.sin(seconds * 2 + baseY + mesh.position.x) * 0.06;
      mesh.rotation.y = seconds * 0.8;
    }
  }
}
