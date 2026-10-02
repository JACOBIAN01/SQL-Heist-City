import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_CHALLENGE_SETTINGS, DEFAULT_REWARD_TIERS } from '@heist/shared';
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
    await user.click(screen.getByRole('button', { name: 'Save rules' }));
    await user.selectOptions(await screen.findByLabelText('gun:rifle min'), '2');
    await user.click(screen.getByRole('button', { name: 'Save tiers' }));

    await screen.findAllByText('Saved ✓');
    const settingsPut = calls.find((c) => c.method === 'PUT' && c.path === '/config/settings');
    expect(settingsPut?.body).toMatchObject({ challenges: { lockoutSec: 15 } });
    const rewardsPut = calls.find((c) => c.path === '/config/reward-map' && c.method === 'PUT');
    expect(
      (rewardsPut?.body as { rewards: { key: string; min: number }[] }).rewards,
    ).toContainEqual({
      key: 'gun:rifle',
      min: 2,
      max: 4,
    });
  });

  it('teachers see values read-only', async () => {
    api(teacher);
    renderWithProviders(<SettingsPage />);
    expect(
      ((await screen.findByLabelText(/Lockout after a wrong answer/)) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save rules' })).toBeNull();
  });
});
