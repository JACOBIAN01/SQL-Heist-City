import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROGRESSION_SETTINGS as S,
  progressView,
  skillTree,
  type ProgressView,
} from '@heist/shared';
import { InMemoryLoadoutStore } from './LoadoutStore';
import { LoadoutKeeper } from './LoadoutKeeper';

function keeper(xp = 0, mastered: [string, number][] = []) {
  const state: { progress: ProgressView } = { progress: progressView(xp, 0, S) };
  const topics = new Map(mastered.map(([t]) => [t, { earned: 10, available: 10, items: 5 }]));
  const store = new InMemoryLoadoutStore();
  const k = new LoadoutKeeper(
    store,
    () => S,
    async () => state.progress,
    () => skillTree(topics, S),
  );
  return { k, store, state };
}

describe('LoadoutKeeper', () => {
  it('lets a student wear what they have earned and remembers it', async () => {
    const { k, store } = keeper(150);
    const w = await k.choose(1, 'outfit', 'outfit-crimson');
    expect(w.choice).toEqual({ outfit: 'outfit-crimson' });
    expect(await store.get(1)).toEqual({ outfit: 'outfit-crimson' });
    expect(k.lookOf(w.choice)).toEqual({ outfit: 0xc0392b });
  });

  it('refuses what is locked, unknown or in the wrong slot, keeping what was worn', async () => {
    const { k } = keeper(150);
    await k.choose(1, 'outfit', 'outfit-crimson');
    expect((await k.choose(1, 'outfit', 'outfit-gold')).choice).toEqual({
      outfit: 'outfit-crimson',
    });
    expect((await k.choose(1, 'outfit', 'nope')).choice).toEqual({ outfit: 'outfit-crimson' });
    expect((await k.choose(1, 'mask', 'outfit-street')).choice).toEqual({
      outfit: 'outfit-crimson',
    });
  });

  it('takes an item off with null', async () => {
    const { k } = keeper(150);
    await k.choose(1, 'outfit', 'outfit-crimson');
    expect((await k.choose(1, 'outfit', null)).choice).toEqual({});
  });

  it('unlocks by skill too, and a stored choice that is no longer earned is dropped', async () => {
    const { k, store } = keeper(0, [['group-by', 5]]);
    expect(await store.get(1)).toEqual({});
    await store.put(1, { paint: 'paint-gold' }); // not earned (a changed setting, say)
    expect((await k.wardrobeOf(1)).choice).toEqual({});
    // Mastering Grouping (its topics) earns the night suit.
    const night = (await k.wardrobeOf(1)).items.find((i) => i.id === 'outfit-night');
    expect(night?.unlocked).toBe(true);
  });
});
