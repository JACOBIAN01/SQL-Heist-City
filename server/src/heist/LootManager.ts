import type { BagView } from '@heist/shared';

/** Cash bags lying in the world: from an opened vault, or dropped by a player who died. */
export class LootManager {
  private readonly bags = new Map<number, BagView>();
  private nextId = 1;

  add(x: number, y: number, z: number, amount: number): BagView {
    const bag: BagView = { id: this.nextId++, x, y, z, amount };
    this.bags.set(bag.id, bag);
    return bag;
  }

  remove(id: number): BagView | undefined {
    const bag = this.bags.get(id);
    this.bags.delete(id);
    return bag;
  }

  /** Takes every bag away and returns their ids (a new round). */
  clear(): number[] {
    const ids = [...this.bags.keys()];
    this.bags.clear();
    return ids;
  }

  all(): BagView[] {
    return [...this.bags.values()];
  }

  get count(): number {
    return this.bags.size;
  }

  /** Splits a vault's cash over its loot spots; the remainder (if any) goes in the first bag. */
  static split(total: number, parts: number): number[] {
    if (parts <= 0) return [];
    const each = Math.floor(total / parts);
    return Array.from({ length: parts }, (_, i) => (i === 0 ? total - each * (parts - 1) : each));
  }
}
