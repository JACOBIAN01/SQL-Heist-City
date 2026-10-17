import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  DEFAULT_KEYS,
  DEFAULT_PLAYER_SETTINGS,
  RESERVED_KEYS,
  keyConflicts,
  keyLabel,
  keysFor,
  playerSettingsSchema,
  readPlayerSettings,
} from './playerSettings';

describe('player settings (22.1)', () => {
  it('has a default for everything, and every action has default keys that do not clash', () => {
    expect(playerSettingsSchema.parse({})).toEqual(DEFAULT_PLAYER_SETTINGS);
    for (const a of ACTIONS) expect(DEFAULT_KEYS[a].length, a).toBeGreaterThan(0);
    expect(keyConflicts(DEFAULT_PLAYER_SETTINGS)).toEqual([]);
    for (const keys of Object.values(DEFAULT_KEYS))
      for (const k of keys) expect(RESERVED_KEYS.has(k)).toBe(false);
  });

  it('refuses values outside their limits', () => {
    const bad = (over: object) => playerSettingsSchema.safeParse(over).success;
    expect(bad({ look: { sensitivity: 9, invertY: false, fov: 70 } })).toBe(false);
    expect(bad({ look: { sensitivity: 1, invertY: false, fov: 130 } })).toBe(false);
    expect(bad({ audio: { master: 2, effects: 1, ambience: 1 } })).toBe(false);
    expect(bad({ access: { textScale: 3 } })).toBe(false);
    expect(bad({ keys: { jump: ['not a key!'] } })).toBe(false);
    expect(bad({ keys: { notAnAction: ['KeyZ'] } })).toBe(true); // unknown actions are ignored, not stored
    expect(playerSettingsSchema.parse({ keys: { notAnAction: ['KeyZ'] } }).keys).toEqual({});
  });

  it('uses the default keys unless the player chose others, and flags a clash', () => {
    const s = playerSettingsSchema.parse({ keys: { jump: ['KeyW'], use: ['KeyE'] } });
    expect(keysFor(s, 'jump')).toEqual(['KeyW']);
    expect(keysFor(s, 'sprint')).toEqual(DEFAULT_KEYS.sprint);
    expect(keyConflicts(s)).toEqual([{ key: 'KeyW', actions: ['forward', 'jump'] }]);
  });

  it('keeps what is valid when one section is damaged, and survives rubbish', () => {
    const read = readPlayerSettings({
      look: { sensitivity: 2, invertY: true, fov: 80 },
      audio: { master: 'loud' },
      locale: 'hi',
    });
    expect(read.look).toEqual({ sensitivity: 2, invertY: true, fov: 80 });
    expect(read.audio).toEqual(DEFAULT_PLAYER_SETTINGS.audio);
    expect(read.locale).toBe('hi');
    expect(readPlayerSettings(null)).toEqual(DEFAULT_PLAYER_SETTINGS);
    expect(readPlayerSettings('text')).toEqual(DEFAULT_PLAYER_SETTINGS);
  });

  it('names keys for the screen', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Mouse2')).toBe('Right mouse');
    expect(keyLabel('ShiftLeft')).toBe('Shift left');
    expect(keyLabel('Space')).toBe('Space');
  });
});
