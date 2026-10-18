import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_SETTINGS } from '@heist/shared';
import { I18n } from '../i18n/I18n';
import { controlsHint } from './controlsHint';

describe('controlsHint', () => {
  it('lists the keys the player has now', () => {
    const i = new I18n('en');
    expect(controlsHint(DEFAULT_PLAYER_SETTINGS, i.t)).toContain('F Use');
    const changed = { ...DEFAULT_PLAYER_SETTINGS, keys: { use: ['KeyG'] } };
    const text = controlsHint(changed, i.t);
    expect(text).toContain('G Use');
    expect(text).toContain('WASD');
    expect(text).toContain('1–5');
  });
});
