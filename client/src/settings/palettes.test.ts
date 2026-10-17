import { describe, expect, it } from 'vitest';
import { PALETTES as NAMES } from '@heist/shared';
import { colorDistance, contrast, parseHex, simulate, type Vision } from './color';
import { PALETTES, paletteVariables } from './palettes';

describe('colour tools', () => {
  it('measures contrast the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
  });

  it('leaves greys alone and moves red and green together for red/green-blind people', () => {
    const grey = simulate('#808080', 'deuteranopia');
    expect(Math.abs(grey[0] - grey[1])).toBeLessThan(2);
    const red = '#ff0000';
    const green = '#00c000';
    const plain = colorDistance(parseHex(red), parseHex(green));
    const seen = colorDistance(simulate(red, 'deuteranopia'), simulate(green, 'deuteranopia'));
    expect(seen).toBeLessThan(plain / 2);
  });
});

const MEANING = ['good', 'bad', 'warn', 'info', 'accent'] as const;

describe('palettes (22.3)', () => {
  it('has one for every name, with a full set of colours', () => {
    expect(Object.keys(PALETTES).sort()).toEqual([...NAMES].sort());
    expect(Object.keys(paletteVariables('default'))).toContain('--c-good');
  });

  for (const name of NAMES) {
    it(`${name}: every colour that carries meaning, and the text, is readable on the panel (4.5:1)`, () => {
      const c = PALETTES[name];
      for (const k of [...MEANING, 'text', 'muted'] as const)
        expect(contrast(c[k], c.bg), `${name} ${k}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('high contrast reaches 7:1 (WCAG AAA) for text and the meaning colours', () => {
    const c = PALETTES['high-contrast'];
    for (const k of [...MEANING, 'text', 'muted'] as const)
      expect(contrast(c[k], c.bg), k).toBeGreaterThanOrEqual(7);
  });

  for (const vision of ['deuteranopia', 'protanopia', 'tritanopia'] as Vision[]) {
    it(`${vision}: good and bad stay clearly apart for someone who has it, in every palette made for them`, () => {
      const own = NAMES.filter((n) => n === vision);
      for (const name of own) {
        const c = PALETTES[name];
        const d = colorDistance(simulate(c.good, vision), simulate(c.bad, vision));
        expect(d, `${name} good vs bad`).toBeGreaterThan(30);
        // …and so do the other meaning colours from each other.
        for (const [a, b] of [
          ['good', 'warn'],
          ['bad', 'warn'],
          ['good', 'info'],
        ] as const) {
          const dist = colorDistance(simulate(c[a], vision), simulate(c[b], vision));
          expect(dist, `${name} ${a} vs ${b}`).toBeGreaterThan(20);
        }
      }
    });
  }

  it('the default palette is the one that fails them (which is why the others exist)', () => {
    const c = PALETTES.default;
    const d = colorDistance(simulate(c.good, 'deuteranopia'), simulate(c.bad, 'deuteranopia'));
    const fixed = colorDistance(
      simulate(PALETTES.deuteranopia.good, 'deuteranopia'),
      simulate(PALETTES.deuteranopia.bad, 'deuteranopia'),
    );
    expect(fixed).toBeGreaterThan(d);
  });
});
