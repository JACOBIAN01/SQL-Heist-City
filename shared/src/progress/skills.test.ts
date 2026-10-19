import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROGRESSION_SETTINGS as S,
  DEFAULT_SKILL_TREE,
  progressionSettingsSchema,
} from '../config/progression';
import { skillTree, type TopicMarks } from './skills';

const marks = (earned: number, available: number, items: number): TopicMarks => ({
  earned,
  available,
  items,
});
const state = (views: ReturnType<typeof skillTree>, id: string) => views.find((v) => v.id === id);

describe('skill tree', () => {
  it('opens only the roots for a new student', () => {
    const v = skillTree(new Map(), S);
    expect(state(v, 'select')).toMatchObject({ state: 'open', progress: null, depth: 0 });
    expect(state(v, 'filter')?.state).toBe('locked');
    expect(state(v, 'windows')?.state).toBe('locked');
  });

  it('masters a node on enough good work, which opens what it unlocks', () => {
    const v = skillTree(new Map([['select', marks(8, 10, 3)]]), S);
    expect(state(v, 'select')).toMatchObject({ state: 'mastered', progress: 0.8, items: 3 });
    expect(state(v, 'filter')?.state).toBe('open');
    expect(state(v, 'sort')?.state).toBe('open');
    expect(state(v, 'joins')?.state).toBe('locked'); // needs filter and sort
  });

  it('needs both enough questions and enough marks', () => {
    expect(state(skillTree(new Map([['select', marks(2, 2, 2)]]), S), 'select')?.state).toBe(
      'open',
    );
    expect(state(skillTree(new Map([['select', marks(3, 10, 5)]]), S), 'select')?.state).toBe(
      'open',
    );
  });

  it('pools a node’s topics, and lays the tree out in rows by depth', () => {
    const v = skillTree(
      { where: marks(4, 5, 2), null: marks(3, 3, 1), select: marks(10, 10, 5) },
      S,
    );
    expect(state(v, 'filter')).toMatchObject({ state: 'mastered', items: 3 });
    expect(state(v, 'select')?.depth).toBe(0);
    expect(state(v, 'filter')?.depth).toBe(1);
    expect(state(v, 'window-frames')?.depth).toBeGreaterThan(state(v, 'windows')?.depth ?? 99);
  });

  it('the shipped tree is valid, covers only known topics once, and has no loops', () => {
    const seen = new Set<string>();
    for (const n of DEFAULT_SKILL_TREE)
      for (const t of n.topics) {
        expect(seen.has(t), `${t} appears twice`).toBe(false);
        seen.add(t);
      }
    expect(() => progressionSettingsSchema.parse({})).not.toThrow();
  });

  it('refuses a tree with a loop or an unknown requirement', () => {
    const bad = (tree: unknown) =>
      progressionSettingsSchema.safeParse({ skills: { tree } }).success;
    expect(bad([{ id: 'a', name: 'A', topics: ['x'], requires: ['b'] }])).toBe(false);
    expect(
      bad([
        { id: 'a', name: 'A', topics: ['x'], requires: ['b'] },
        { id: 'b', name: 'B', topics: ['y'], requires: ['a'] },
      ]),
    ).toBe(false);
    expect(bad([{ id: 'a', name: 'A', topics: ['x'] }])).toBe(true);
  });
});
