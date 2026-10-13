import { describe, expect, it } from 'vitest';
import { DEFAULT_REWARD_ICONS, iconIdFor, rewardIconsSchema } from './rewardIcons';
import { DEFAULT_REWARD_TIERS } from './challenges';

describe('reward icons', () => {
  it('the defaults are valid and cover every reward that has a tier', () => {
    expect(rewardIconsSchema.safeParse(DEFAULT_REWARD_ICONS).success).toBe(true);
    for (const key of Object.keys(DEFAULT_REWARD_TIERS))
      expect(DEFAULT_REWARD_ICONS).toHaveProperty(key);
  });

  it('refuses an icon that is not in the library', () => {
    expect(
      rewardIconsSchema.safeParse({ ...DEFAULT_REWARD_ICONS, 'gun:smg': 'banana' }).success,
    ).toBe(false);
  });

  it('finds the icon for a reward, every vault lock sharing one, unknown rewards getting cash', () => {
    const icons = { ...DEFAULT_REWARD_ICONS, 'gun:smg': 'rifle', vault: 'lock' };
    expect(iconIdFor(icons, 'gun:smg')).toBe('rifle');
    expect(iconIdFor(icons, 'vault:bank3:2')).toBe('lock');
    expect(iconIdFor(icons, 'gun:laser')).toBe('cash');
  });
});
