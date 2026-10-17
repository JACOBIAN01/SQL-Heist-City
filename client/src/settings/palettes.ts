import type { Palette } from '@heist/shared';

/** The meaning-carrying colours of the interface. Everything else is grey, white or black. */
export interface PaletteColors {
  /** Good: health, a correct answer, success. */
  readonly good: string;
  /** Bad: damage, a wrong answer, danger. */
  readonly bad: string;
  /** Needs attention: warnings, bounties, money. */
  readonly warn: string;
  /** Neutral information, links, highlights. */
  readonly info: string;
  /** The panel's main accent. */
  readonly accent: string;
  /** Normal text. */
  readonly text: string;
  /** Quiet text. */
  readonly muted: string;
  /** Panel background (opaque part). */
  readonly bg: string;
}

/**
 * Colours chosen for each way of seeing (Phase 22.3). Red/green-blind palettes (the commonest,
 * about 1 boy in 12) use blue against orange, with a pale yellow for warnings that is lighter than
 * the orange (found by searching for sets whose meanings stay apart when simulated); the
 * blue/yellow one keeps red and green but moves "information" away from blue; high contrast is
 * white text on near-black with saturated colours.
 */
export const PALETTES: Readonly<Record<Palette, PaletteColors>> = {
  default: {
    good: '#4cc38a',
    bad: '#ef6b5f',
    warn: '#ffd34d',
    info: '#6cc4e8',
    accent: '#d4a017',
    text: '#e8ebf0',
    muted: '#a9b3c2',
    bg: '#0e1116',
  },
  deuteranopia: {
    good: '#4aa3ff',
    bad: '#ff6b35',
    warn: '#f5f5a0',
    info: '#e0a3c8',
    accent: '#f5f5a0',
    text: '#e8ebf0',
    muted: '#a9b3c2',
    bg: '#0e1116',
  },
  protanopia: {
    good: '#4aa3ff',
    bad: '#ff6b35',
    warn: '#f5f5a0',
    info: '#e0a3c8',
    accent: '#f5f5a0',
    text: '#e8ebf0',
    muted: '#a9b3c2',
    bg: '#0e1116',
  },
  tritanopia: {
    good: '#2ee59d',
    bad: '#ff5c5c',
    warn: '#ff9eb5',
    info: '#e8ebf0',
    accent: '#ff9eb5',
    text: '#e8ebf0',
    muted: '#a9b3c2',
    bg: '#0e1116',
  },
  'high-contrast': {
    good: '#00ff7f',
    bad: '#ff6b6b',
    warn: '#ffff00',
    info: '#4dd2ff',
    accent: '#ffff00',
    text: '#ffffff',
    muted: '#e0e0e0',
    bg: '#000000',
  },
};

/** The CSS variables a palette sets on the page. */
export function paletteVariables(palette: Palette): Record<string, string> {
  const c = PALETTES[palette];
  return {
    '--c-good': c.good,
    '--c-bad': c.bad,
    '--c-warn': c.warn,
    '--c-info': c.info,
    '--c-accent': c.accent,
    '--c-text': c.text,
    '--c-muted': c.muted,
    '--c-bg': c.bg,
  };
}
