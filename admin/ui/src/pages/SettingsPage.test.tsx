import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DEFAULT_CHALLENGE_SETTINGS,
  DEFAULT_CHEAT_SETTINGS,
  cheatAdminView,
  DEFAULT_ANALYTICS_SETTINGS,
  DEFAULT_ATMOSPHERE_SETTINGS,
  DEFAULT_CITY_SETTINGS,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_NAME_RULES,
  DEFAULT_REWARD_ICONS,
  DEFAULT_REWARD_TIERS,
  DEFAULT_VEHICLE_SETTINGS,
  DEFAULT_TUTORIAL_SETTINGS,
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

const cheatView = { ...cheatAdminView(DEFAULT_CHEAT_SETTINGS) };

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
    'GET /config/tutorial': () => ({
      body: {
        tutorial: { current: DEFAULT_TUTORIAL_SETTINGS, defaults: DEFAULT_TUTORIAL_SETTINGS },
      },
    }),
    'PUT /config/tutorial': (b) => ({ body: b }),
    'GET /config/heist': () => ({
      body: { heist: { current: DEFAULT_HEIST_SETTINGS, defaults: DEFAULT_HEIST_SETTINGS } },
    }),
    'GET /config/vehicles': () => ({
      body: {
        vehicles: { current: DEFAULT_VEHICLE_SETTINGS, defaults: DEFAULT_VEHICLE_SETTINGS },
      },
    }),
    'GET /config/atmosphere': () => ({
      body: {
        atmosphere: {
          current: DEFAULT_ATMOSPHERE_SETTINGS,
          defaults: DEFAULT_ATMOSPHERE_SETTINGS,
        },
      },
    }),
    'GET /config/city': () => ({
      body: { city: { current: DEFAULT_CITY_SETTINGS, defaults: DEFAULT_CITY_SETTINGS } },
    }),
    'GET /config/rewardIcons': () => ({
      body: {
        rewardIcons: { current: DEFAULT_REWARD_ICONS, defaults: DEFAULT_REWARD_ICONS },
      },
    }),
    'PUT /config/rewardIcons': (b) => ({ body: b }),
    'GET /config/names': () => ({
      body: { names: { current: DEFAULT_NAME_RULES, defaults: DEFAULT_NAME_RULES } },
    }),
    'PUT /config/names': (b) => ({ body: b }),
    'GET /config/analytics': () => ({
      body: {
        analytics: { current: DEFAULT_ANALYTICS_SETTINGS, defaults: DEFAULT_ANALYTICS_SETTINGS },
      },
    }),
    'GET /config/cheat': () => ({
      body: { cheat: { current: cheatView, defaults: cheatView } },
    }),
    'PUT /config/cheat': (b) => ({ body: b }),
    'PUT /config/vehicles': (b) => ({ body: b }),
    'PUT /config/city': (b) => ({ body: b }),
    'GET /questions': () => ({
      body: {
        questions: [...Object.values(DEFAULT_TUTORIAL_SETTINGS.questions), 't1-light-loot'].map(
          (slug, i) => ({
            id: i + 1,
            slug,
            title: `Question ${i + 1}`,
            tier: 1,
            topics: [],
            enabled: true,
            version: 1,
            updatedAt: '',
          }),
        ),
      },
    }),
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

  it('admins pick a tutorial question', async () => {
    const calls = api(admin);
    renderWithProviders(<SettingsPage />);
    const user = userEvent.setup();
    const gun = await screen.findByLabelText('Gun task');
    await screen.findAllByText(/t1-light-loot/);
    await user.selectOptions(gun, 't1-light-loot');
    await user.click(screen.getByRole('button', { name: 'Save tutorial' }));
    await screen.findByText('Saved ✓');
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/config/tutorial');
    expect(put?.body).toEqual({
      tutorial: { questions: { ...DEFAULT_TUTORIAL_SETTINGS.questions, gun: 't1-light-loot' } },
    });
  });

  it('admins retune one car and send only what changed', async () => {
    const calls = api(admin);
    renderWithProviders(<SettingsPage />);
    const user = userEvent.setup();
    const top = await screen.findByLabelText('vehicles kinds.sedan.maxSpeed');
    await user.clear(top);
    await user.type(top, '31');
    await user.click(screen.getByRole('button', { name: 'Save vehicles' }));
    await screen.findByText('Saved ✓');
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/config/vehicles');
    expect(put?.body).toEqual({ vehicles: { kinds: { sedan: { maxSpeed: 31 } } } });
  });

  it('admins change the city seed (text) and nothing else is sent', async () => {
    const calls = api(admin);
    renderWithProviders(<SettingsPage />);
    const user = userEvent.setup();
    const seed = await screen.findByLabelText('city seed');
    await user.clear(seed);
    await user.type(seed, 'autumn');
    await user.click(screen.getByRole('button', { name: 'Save city' }));
    await screen.findByText('Saved ✓');
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/config/city');
    expect(put?.body).toEqual({ city: { seed: 'autumn' } });
  });

  it('admins pick another icon for a reward and send only that change', async () => {
    const calls = api(admin);
    renderWithProviders(<SettingsPage />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('icon gun:smg'), 'sniper');
    await user.click(screen.getByRole('button', { name: 'Save icons' }));
    await screen.findByText('Saved ✓');
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/config/rewardIcons');
    expect(put?.body).toEqual({ rewardIcons: { 'gun:smg': 'sniper' } });
  });

  it('admins edit the blocked words, one per line', async () => {
    const calls = api(admin);
    renderWithProviders(<SettingsPage />);
    const user = userEvent.setup();
    const box = await screen.findByLabelText('Blocked words');
    await user.clear(box);
    await user.type(box, 'banana{enter}split');
    await user.click(screen.getByRole('button', { name: 'Save names' }));
    await screen.findByText('Saved ✓');
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/config/names');
    expect(put?.body).toEqual({
      names: { blocked: ['banana', 'split'], allowed: DEFAULT_NAME_RULES.allowed },
    });
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

  it('admins set a cheat code and scope; the code is sent once and never shown', async () => {
    const calls = api(admin);
    renderWithProviders(<SettingsPage />);
    const user = userEvent.setup();
    const code = await screen.findByLabelText('New cheat code');
    expect((code as HTMLInputElement).type).toBe('password');
    await user.type(code, 'my-new-code');
    await user.selectOptions(screen.getByLabelText('Cheat scope'), 'dev');
    await user.click(screen.getByRole('button', { name: 'Save cheat settings' }));
    await screen.findAllByText('Saved ✓');
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/config/cheat');
    expect(put?.body).toMatchObject({ cheat: { scope: 'dev', newCode: 'my-new-code' } });
    expect(JSON.stringify(put?.body)).not.toContain('codeHash');
    expect(((await screen.findByLabelText('New cheat code')) as HTMLInputElement).value).toBe('');
  });

  it('teachers do not see the cheat card at all', async () => {
    api(teacher);
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Tutorial questions');
    expect(screen.queryByText('Cheat code')).toBeNull();
  });
});
