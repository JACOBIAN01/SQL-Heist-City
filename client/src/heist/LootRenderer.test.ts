import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { LootRenderer } from './LootRenderer';

const bag = (id: number, amount = 10_000) => ({ id, x: 1, y: 6, z: 2, amount });

describe('LootRenderer', () => {
  it('adds a bag at its place and removes it when told', () => {
    const scene = new Scene();
    const loot = new LootRenderer(scene);
    loot.apply([bag(1), bag(2)], []);
    expect(loot.count).toBe(2);
    expect(scene.children).toHaveLength(2);
    expect(scene.children[0]?.position.y).toBe(6);
    loot.apply([], [1]);
    expect(loot.count).toBe(1);
    expect(scene.children).toHaveLength(1);
  });

  it('ignores a repeated add or an unknown removal', () => {
    const scene = new Scene();
    const loot = new LootRenderer(scene);
    loot.apply([bag(1)], []);
    loot.apply([bag(1)], [99]);
    expect(loot.count).toBe(1);
    expect(scene.children).toHaveLength(1);
  });

  it('draws a bigger pile bigger, and bobs the bags', () => {
    const scene = new Scene();
    const loot = new LootRenderer(scene);
    loot.apply([bag(1, 1_000), bag(2, 200_000)], []);
    const [small, big] = scene.children;
    expect((big?.scale.x ?? 0) > (small?.scale.x ?? 0)).toBe(true);
    loot.update(0);
    const before = small?.position.y;
    loot.update(0.5);
    expect(small?.position.y).not.toBe(before);
  });
});
