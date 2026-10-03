import { describe, expect, it } from 'vitest';
import { DEFAULT_REWARD_TIERS } from '@heist/shared';
import { rewardIcon } from './icons';

const svgOf = (key: string) => rewardIcon(key).innerHTML;

describe('rewardIcon', () => {
  it('has an icon for every default reward, each different from the generic fallback', () => {
    const fallback = svgOf('unknown:thing');
    for (const key of Object.keys(DEFAULT_REWARD_TIERS)) {
      expect(svgOf(key), key).toContain('<svg');
      expect(svgOf(key), key).not.toBe(fallback);
    }
  });

  it('gives all vault locks the vault icon and unknown rewards a fallback', () => {
    expect(svgOf('vault:bank-1:lock-1')).toBe(svgOf('vault:bank-5:lock-3'));
    expect(svgOf('mystery')).toContain('<svg');
  });

  it('is decorative and tintable', () => {
    const el = rewardIcon('gun:pistol');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.innerHTML).toContain('currentColor');
    expect(el.innerHTML).not.toContain('#fff');
  });
});
