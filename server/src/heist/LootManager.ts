import type { BagView } from '@heist/shared';

/** Cash lying in the world: vault bags, bags dropped by the dead, and loose office cash. */
export class LootManager {
  private readonly bags = new Map<number, BagView>();
  private nextId = 1;

  /** `loose`: office cash (12.1), which never holds a round open. */
  add(x: number, y: number, z: number, amount: number, loose = false): BagView {
    const bag: BagView = { id: this.nextId++, x, y, z, amount, ...(loose ? { loose: true } : {}) };
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

  /** Bags worth fighting over: vault loot and dropped cash, not the offices' loose piles. */
  get stakes(): number {
    let n = 0;
    for (const bag of this.bags.values()) if (!bag.loose) n++;
    return n;
  }

  /** Splits a vault's cash over its loot spots; the remainder (if any) goes in the first bag. */
  static split(total: number, parts: number): number[] {
    if (parts <= 0) return [];
    const each = Math.floor(total / parts);
    return Array.from({ length: parts }, (_, i) => (i === 0 ? total - each * (parts - 1) : each));
  }
}
