import { describe, expect, it } from 'vitest';
import { DEFAULT_CHEAT_SETTINGS, cheatAdminView, cheatSettingsSchema } from './cheat';

describe('cheat settings', () => {
  it('start switched off, with no code, and a three-key combination', () => {
    expect(DEFAULT_CHEAT_SETTINGS).toMatchObject({ scope: 'off', codeHash: '', payReward: true });
    expect(DEFAULT_CHEAT_SETTINGS.combo).toHaveLength(3);
  });
  it('need two or three keys', () => {
    expect(cheatSettingsSchema.safeParse({ combo: ['KeyA'] }).success).toBe(false);
    expect(
      cheatSettingsSchema.safeParse({ combo: ['A', 'B', 'C', 'D'].map((k) => `Key${k}`) }).success,
    ).toBe(false);
    expect(cheatSettingsSchema.safeParse({ combo: ['KeyA', 'KeyB'] }).success).toBe(true);
  });
  it('show the admin whether a code is set, never the hash', () => {
    const view = cheatAdminView({ ...DEFAULT_CHEAT_SETTINGS, codeHash: 'scrypt$x' });
    expect(view.codeSet).toBe(true);
    expect('codeHash' in view).toBe(false);
  });
});
