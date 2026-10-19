import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SKILL_TREE } from '@heist/shared';

// Phase 26.2: a topic in the question files that no node counts would be work that never shows in
// the tree. When a topic is added to a question, this test says which node should take it.
describe('the default skill tree', () => {
  it('counts every topic the shipped questions use', () => {
    const dir = new URL('../../../content/questions/', import.meta.url);
    const used = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const parsed = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as unknown;
      const questions = (
        Array.isArray(parsed)
          ? parsed
          : ((parsed as { questions?: unknown[] }).questions ?? [parsed])
      ) as {
        topic?: string[];
      }[];
      for (const q of questions) for (const t of q.topic ?? []) used.add(t);
    }
    const counted = new Set(DEFAULT_SKILL_TREE.flatMap((n) => n.topics));
    expect([...used].filter((t) => !counted.has(t))).toEqual([]);
    expect(used.size).toBeGreaterThan(40);
  });
});
