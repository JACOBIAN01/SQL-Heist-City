import { describe, expect, it } from 'vitest';
import {
  SHARE_CODE,
  customHeistSpecSchema,
  customMode,
  customModeId,
  newShareCode,
  parseCustomModeId,
} from './customHeist';
import { modeSchema } from './modes';

const spec = customHeistSpecSchema.parse({
  name: 'Library job',
  locks: ['select-all', 'where-basics'],
});

describe('custom heists (34.5)', () => {
  it('fills in a short story, one bank and a round length', () => {
    expect(spec.bank).toBe(1);
    expect(spec.story.lines.length).toBeGreaterThan(0);
    expect(spec.roundMinutes).toBe(15);
  });

  it('needs a name and one to five questions, by slug', () => {
    expect(() => customHeistSpecSchema.parse({ name: '', locks: ['a'] })).toThrow();
    expect(() => customHeistSpecSchema.parse({ name: 'x', locks: [] })).toThrow();
    expect(() => customHeistSpecSchema.parse({ name: 'x', locks: Array(6).fill('a') })).toThrow();
    expect(() => customHeistSpecSchema.parse({ name: 'x', locks: ['Not A Slug'] })).toThrow();
  });

  it('plays as a one-bank mode with a lock for each question', () => {
    const mode = customMode(7, spec);
    expect(modeSchema.safeParse(mode).success).toBe(true);
    expect(mode).toMatchObject({ id: 'custom-7', bankLimit: 1, kind: 'heist' });
    expect(mode.heist).toMatchObject({ locksPerVault: 2, roundMinutes: 15 });
  });

  it('names its mode by id, and reads the id back', () => {
    expect(customModeId(12)).toBe('custom-12');
    expect(parseCustomModeId('custom-12')).toBe(12);
    expect(parseCustomModeId('classic')).toBeUndefined();
    expect(parseCustomModeId('custom-x')).toBeUndefined();
  });

  it('makes share codes that are easy to read out', () => {
    for (let i = 0; i < 50; i++) expect(newShareCode()).toMatch(SHARE_CODE);
    expect(new Set(Array.from({ length: 50 }, () => newShareCode())).size).toBeGreaterThan(45);
  });
});
