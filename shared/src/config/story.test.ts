import { describe, expect, it } from 'vitest';
import { BARK_EVENTS, DEFAULT_STORY_SETTINGS as S, frameFor, storySettingsSchema } from './story';

describe('the story settings (32.1)', () => {
  it('has one chain for each of the five banks, in tier order', () => {
    expect(S.chains.map((c) => c.bank)).toEqual(['bank-1', 'bank-2', 'bank-3', 'bank-4', 'bank-5']);
  });

  it('gives every chain a fixer, a briefing first and the heist last', () => {
    for (const c of S.chains) {
      expect(c.fixer.name.length).toBeGreaterThan(2);
      expect(c.steps[0]?.need.type).toBe('intel');
      expect(c.steps.at(-1)?.need.type).toBe('heist');
      expect(new Set(c.steps.map((s) => s.id)).size).toBe(c.steps.length);
    }
  });

  it('asks for more intel and a harder favour as the banks go up', () => {
    const level = (bank: string) => {
      const need = S.chains.find((c) => c.bank === bank)?.steps[0]?.need;
      return need?.type === 'intel' ? need.level : 0;
    };
    expect(level('bank-5')).toBeGreaterThan(level('bank-1'));
    const cash = S.chains.map((c) => c.reward.cash);
    expect(cash).toEqual([...cash].sort((a, b) => a - b));
  });

  it('has a scene for every chain’s start and end, each with someone speaking', () => {
    for (const c of S.chains)
      for (const id of [c.intro, c.outro]) {
        const scene = S.scenes[id];
        expect(scene, id).toBeDefined();
        expect(scene?.lines.every((l) => l.speaker.length > 0 && l.text.length > 0)).toBe(true);
      }
  });

  it('has a bark for every moment, so no moment is silent', () => {
    for (const e of BARK_EVENTS) expect(S.barks['any']?.[e]?.length, e).toBeGreaterThan(0);
  });

  it('frames the questions of every bank’s vault and intel', () => {
    for (const c of S.chains) {
      expect(S.frames[`vault:${c.bank}`], c.bank).toBeDefined();
      expect(S.frames[`intel:${c.bank}`], c.bank).toBeDefined();
    }
  });

  it('keeps every page of evidence different, one per bank', () => {
    expect(new Set(S.chains.map((c) => c.page)).size).toBe(5);
  });

  it('finds the most specific frame for a reward, falling back to its family', () => {
    const frames = { 'vault:bank-3': 'Inez.', vault: 'Any vault.', job: 'The crew.' };
    expect(frameFor('vault:bank-3:lock-2', frames)).toBe('Inez.');
    expect(frameFor('vault:bank-1:lock-1', frames)).toBe('Any vault.');
    expect(frameFor('job:escort', frames)).toBe('The crew.');
    expect(frameFor('heal:small', frames)).toBeUndefined();
    expect(frameFor('vault:bank-3:lock-2', { 'vault:bank-3:lock-2': 'Exact.', ...frames })).toBe(
      'Exact.',
    );
  });

  it('rejects a chain for a bank that does not exist', () => {
    const bad = { chains: [{ ...S.chains[0], bank: 'bank-9' }] };
    expect(() => storySettingsSchema.parse(bad)).toThrow();
  });
});
