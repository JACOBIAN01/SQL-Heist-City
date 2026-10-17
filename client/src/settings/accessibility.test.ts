import { afterEach, describe, expect, it } from 'vitest';
import { playerSettingsSchema } from '@heist/shared';
import { applyAccessibility, reducedMotion } from './accessibility';

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-palette');
  document.documentElement.removeAttribute('data-reduced-motion');
});
const root = () => document.documentElement;
const access = (over: object) => playerSettingsSchema.parse({ access: over });

describe('applyAccessibility (22.3)', () => {
  it('scales all text with one number', () => {
    applyAccessibility(access({ textScale: 1.25 }), root(), false);
    expect(root().style.fontSize).toBe('20px');
    applyAccessibility(access({}), root(), false);
    expect(root().style.fontSize).toBe('16px');
  });

  it('puts a palette on the page, and leaves the original colours alone for the default', () => {
    applyAccessibility(access({ palette: 'deuteranopia' }), root(), false);
    expect(root().dataset.palette).toBe('deuteranopia');
    expect(root().style.getPropertyValue('--c-good')).toBe('#4aa3ff');
    expect(root().style.getPropertyValue('--c-bad')).toBe('#ff6b35');
    applyAccessibility(access({ palette: 'default' }), root(), false);
    expect(root().style.getPropertyValue('--c-good')).toBe('');
  });

  it("turns motion down for the player's choice or the device's", () => {
    const s = (reducedMotion: 'system' | 'on' | 'off') => access({ reducedMotion });
    expect(reducedMotion(s('system'), true)).toBe(true);
    expect(reducedMotion(s('system'), false)).toBe(false);
    expect(reducedMotion(s('on'), false)).toBe(true);
    expect(reducedMotion(s('off'), true)).toBe(false);
    applyAccessibility(s('on'), root(), false);
    expect(root().dataset.reducedMotion).toBe('on');
  });
});
