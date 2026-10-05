import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DEFAULT_CHALLENGE_SETTINGS,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_REWARD_TIERS,
} from '@heist/shared';
import { admin, fakeApi, renderWithProviders, teacher } from '../testing/render';
import { SettingsPage } from './SettingsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rewards = Object.entries(DEFAULT_REWARD_TIERS).map(([key, t]) => ({
  key,
  ...t,
  isDefault: true,
}));

function api(user: typeof admin | typeof teacher) {
  return fakeApi({
    'GET /auth/me': () => ({ body: { user } }),
    'GET /config/settings': () => ({
      body: {
        challenges: { current: DEFAULT_CHALLENGE_SETTINGS, defaults: DEFAULT_CHALLENGE_SETTINGS },
      },
    }),
    'GET /config/reward-map': () => ({ body: { rewards } }),
    'GET /config/combat': () => ({
      body: { combat: { current: DEFAULT_COMBAT_SETTINGS, defaults: DEFAULT_COMBAT_SETTINGS } },
    }),
    'PUT /config/combat': (b) => ({ body: b }),
    'PUT /config/settings': (b) => ({ body: b }),
    'PUT /config/reward-map': (b) => ({ body: b }),
  });
}

describe('SettingsPage', () => {
  it('admins edit and save challenge rules and reward tiers', async () => {
    const calls = api(admin);
    renderWithProviders(<SettingsPage />);
    const user = userEvent.setup();
    const lockout = await screen.findByLabelText(/Lockout after a wrong answer/);
    await user.clear(lockout);
    await user.type(lockout, '15');
    await user.selectOptions(screen.getByLabelText(/How hint costs are charged/), 'absolute');
    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    await user.selectOptions(await screen.findByLabelText('gun:rifle min'), '2');
    await user.click(screen.getByRole('button', { name: 'Save tiers' }));

    await screen.findAllByText('Saved ✓');
    const settingsPut = calls.find((c) => c.method === 'PUT' && c.path === '/config/settings');
    expect(settingsPut?.body).toMatchObject({
      challenges: { lockoutSec: 15, hintCostMode: 'absolute' },
    });
    const rewardsPut = calls.find((c) => c.path === '/config/reward-map' && c.method === 'PUT');
    expect(
      (rewardsPut?.body as { rewards: { key: string; min: number }[] }).rewards,
    ).toContainEqual({
      key: 'gun:rifle',
      min: 2,
      max: 4,
    });
  });

  it('admins retune a gun and save every gun', async () => {
    const calls = api(admin);
    renderWithProviders(<SettingsPage />);
    const user = userEvent.setup();
    const damage = await screen.findByLabelText('smg Damage');
    await user.clear(damage);
    await user.type(damage, '14');
    await user.click(screen.getByRole('button', { name: 'Save guns' }));
    await screen.findByText('Saved ✓');
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/config/combat');
    const weapons = (put?.body as { combat: { weapons: Record<string, { damage: number }> } })
      .combat.weapons;
    expect(weapons.smg?.damage).toBe(14);
    expect(weapons.sniper).toEqual(DEFAULT_COMBAT_SETTINGS.weapons.sniper);
  });

  it('teachers see values read-only', async () => {
    api(teacher);
    renderWithProviders(<SettingsPage />);
    expect(
      ((await screen.findByLabelText(/Lockout after a wrong answer/)) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save rules' })).toBeNull();
    expect(((await screen.findByLabelText('rifle Zoom')) as HTMLInputElement).disabled).toBe(true);
  });
});
