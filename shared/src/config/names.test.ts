import { describe, expect, it } from 'vitest';
import { checkDisplayName, normaliseForFilter, nameRulesSchema } from './names';

describe('checkDisplayName', () => {
  it('accepts ordinary names and tidies spacing', () => {
    expect(checkDisplayName('  Ana   Silva ')).toEqual({ ok: true, name: 'Ana Silva' });
    expect(checkDisplayName("O'Neil-Smith")).toMatchObject({ ok: true });
    expect(checkDisplayName('Zoë 7')).toMatchObject({ ok: true });
    expect(checkDisplayName('李小龍')).toMatchObject({ ok: true });
  });

  it('enforces length by characters, not bytes', () => {
    expect(checkDisplayName('A')).toEqual({ ok: false, reason: 'too_short' });
    expect(checkDisplayName('x'.repeat(21))).toEqual({ ok: false, reason: 'too_long' });
    expect(checkDisplayName('语'.repeat(20))).toMatchObject({ ok: true });
  });

  it('refuses markup, links, control and invisible characters', () => {
    for (const bad of ['<b>x</b>', 'a@b.com', 'http://x.y', 'a​b', 'x\u0000y', '_start', 'a/b'])
      expect(checkDisplayName(bad), bad).toMatchObject({ ok: false, reason: 'characters' });
  });

  it('blocks listed words even when disguised', () => {
    for (const bad of [
      'Shit',
      'sh1t',
      'S.h' + '_i_t'.replace(/_/g, '.') + '.t',
      'fuuuck',
      'xX_f u c k_Xx',
      'b!tch',
      'Ca$$h dick',
    ])
      expect(checkDisplayName(bad), bad).toMatchObject({ ok: false });
    expect(checkDisplayName('Hello World')).toMatchObject({ ok: true });
  });

  it('lets an allowed whole name through, and uses the admin’s own lists', () => {
    expect(checkDisplayName('Dickens')).toMatchObject({ ok: true });
    const rules = nameRulesSchema.parse({ blocked: ['banana'], allowed: [] });
    expect(checkDisplayName('Banana Man', rules)).toEqual({ ok: false, reason: 'blocked' });
    expect(checkDisplayName('shit', rules)).toMatchObject({ ok: true });
  });
});

describe('normaliseForFilter', () => {
  it('folds case, accents, look-alikes and repeats', () => {
    expect(normaliseForFilter('Fúúck-1t')).toBe('fuckit');
    expect(normaliseForFilter('5H1T')).toBe('shit');
  });
});
