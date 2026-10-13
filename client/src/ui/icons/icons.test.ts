import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_REWARD_ICONS, DEFAULT_REWARD_TIERS, REWARD_ICON_IDS } from '@heist/shared';
import { rewardIcon, setRewardIcons } from './icons';

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

describe('admin-chosen icons', () => {
  afterEach(() => setRewardIcons(DEFAULT_REWARD_ICONS));

  it('draws the picture the server says a reward uses', () => {
    const before = svgOf('gun:smg');
    setRewardIcons({ ...DEFAULT_REWARD_ICONS, 'gun:smg': 'sniper' });
    expect(svgOf('gun:smg')).toBe(svgOf('gun:sniper'));
    expect(svgOf('gun:smg')).not.toBe(before);
  });

  it('changes every vault lock at once', () => {
    setRewardIcons({ ...DEFAULT_REWARD_ICONS, vault: 'lock' });
    expect(svgOf('vault:bank-2:lock-1')).not.toBe(svgOf('gun:pistol'));
    expect(svgOf('vault:bank-2:lock-1')).toBe(svgOf('vault:bank-4:lock-3'));
  });

  it('has a picture for every id the admin can choose', () => {
    for (const id of REWARD_ICON_IDS) {
      setRewardIcons({ ...DEFAULT_REWARD_ICONS, 'gun:pistol': id });
      expect(svgOf('gun:pistol'), id).toContain('<svg');
    }
  });
});
