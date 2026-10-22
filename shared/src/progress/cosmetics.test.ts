import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COSMETICS,
  DEFAULT_PROGRESSION_SETTINGS as S,
  DEFAULT_SKILL_TREE,
} from '../config/progression';
import { lookOf, validChoice, wardrobe } from './cosmetics';
import { skillTree } from './skills';
import { progressView } from './xp';

const none = skillTree(new Map(), S);
const view = (xp: number) => progressView(xp, 0, S);
const by = (items: ReturnType<typeof wardrobe>, id: string) => items.find((i) => i.id === id);

describe('cosmetics', () => {
  it('unlocks by rank, and says what a locked one needs', () => {
    const items = wardrobe(view(0), none, S);
    expect(by(items, 'outfit-street')?.unlocked).toBe(true);
    expect(by(items, 'outfit-crimson')).toMatchObject({
      unlocked: false,
      needs: { rank: 'Lookout' },
    });
    expect(by(wardrobe(view(150), none, S), 'outfit-crimson')?.unlocked).toBe(true);
    expect(by(wardrobe(view(150), none, S), 'outfit-teal')?.unlocked).toBe(false);
  });

  it('unlocks by mastering a skill', () => {
    const mastered = skillTree(new Map([['aggregate', { earned: 9, available: 10, items: 5 }]]), S);
    expect(by(wardrobe(view(0), none, S), 'paint-blue')).toMatchObject({
      unlocked: false,
      needs: { skill: 'Aggregates' },
    });
    expect(by(wardrobe(view(0), mastered, S), 'paint-blue')?.unlocked).toBe(true);
  });

  it('keeps only unlocked choices in the right slots', () => {
    const items = wardrobe(view(150), none, S);
    const kept = validChoice(
      { outfit: 'outfit-crimson', mask: 'outfit-street', paint: 'paint-gold' },
      items,
    );
    expect(kept).toEqual({ outfit: 'outfit-crimson' }); // wrong slot and locked ones dropped
    expect(validChoice({ outfit: 'nope' }, items)).toEqual({});
  });

  it('resolves a choice to colours and a mask shape', () => {
    expect(
      lookOf({ outfit: 'outfit-gold', mask: 'mask-visor', paint: 'paint-red' }, DEFAULT_COSMETICS),
    ).toEqual({
      outfit: 0xd4a017,
      mask: { shape: 'visor', color: 0x2980b9 },
      paint: 0xc0392b,
    });
    expect(lookOf({}, DEFAULT_COSMETICS)).toEqual({});
  });

  it('only refers to ranks and skills that exist in the shipped settings', () => {
    const ranks = new Set(S.ranks.map((r) => r.name));
    const nodes = new Set(DEFAULT_SKILL_TREE.map((n) => n.id));
    for (const c of DEFAULT_COSMETICS) {
      if (c.unlock.rank) expect(ranks.has(c.unlock.rank), c.id).toBe(true);
      if (c.unlock.skill) expect(nodes.has(c.unlock.skill), c.id).toBe(true);
    }
    // Nothing is for sale or random: every item names an earned condition, except the free first outfit.
    expect(
      DEFAULT_COSMETICS.filter((c) => !c.unlock.rank && !c.unlock.skill && !c.unlock.season).map(
        (c) => c.id,
      ),
    ).toEqual(['outfit-street']);
  });

  it('never unlocks for a rank name that does not exist', () => {
    const odd = {
      ...S,
      cosmetics: [
        { id: 'x', slot: 'outfit' as const, name: 'X', color: 1, unlock: { rank: 'Nobody' } },
      ],
    };
    expect(wardrobe(view(99999), none, odd)[0]?.unlocked).toBe(false);
  });

  it('unlocks a season item by season XP, for good, and not for a season that is gone', () => {
    const at = (xp: number, settings = S) =>
      wardrobe(view(0), none, settings, { 'autumn-heist': xp }).find(
        (i) => i.id === 'outfit-autumn',
      );
    expect(at(50)).toMatchObject({
      unlocked: false,
      needs: { season: { name: 'Autumn Heist', xp: 100 } },
    });
    expect(at(100)?.unlocked).toBe(true);
    // The season has ended and been taken out of the settings: the item cannot be got any more.
    expect(at(5000, { ...S, seasons: [] })?.unlocked).toBe(false);
  });
});
