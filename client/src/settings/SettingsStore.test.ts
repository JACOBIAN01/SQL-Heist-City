import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLAYER_SETTINGS, playerSettingsSchema, type PlayerSettings } from '@heist/shared';
import { SettingsStore, type SettingsSync } from './SettingsStore';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
};
const mine = (over: object = {}): PlayerSettings => playerSettingsSchema.parse(over);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SettingsStore (22.1)', () => {
  it('starts with the defaults, tells listeners about a change, and keeps it for next time', () => {
    const storage = memory();
    const store = new SettingsStore(storage);
    expect(store.current).toEqual(DEFAULT_PLAYER_SETTINGS);
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.look.fov));
    store.set(mine({ look: { sensitivity: 1, invertY: false, fov: 85 } }));
    expect(seen).toEqual([85]);
    expect(new SettingsStore(storage).current.look.fov).toBe(85);
  });

  it('survives damaged storage, and storage that is blocked', () => {
    const storage = memory();
    storage.data.set('heist.settings.v1', '{not json');
    expect(new SettingsStore(storage).current).toEqual(DEFAULT_PLAYER_SETTINGS);
    storage.data.set(
      'heist.settings.v1',
      JSON.stringify({ settings: { look: { sensitivity: 99 }, locale: 'hi' }, updatedAt: 'x' }),
    );
    const partly = new SettingsStore(storage).current;
    expect(partly.look).toEqual(DEFAULT_PLAYER_SETTINGS.look); // the bad part falls back
    expect(partly.locale).toBe('hi'); // the good part is kept
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = new SettingsStore(blocked);
    store.set(mine({ locale: 'hi' }));
    expect(store.current.locale).toBe('hi');
  });

  it("sends a signed-in player's settings to the account a moment after the last change, once", async () => {
    const saved: PlayerSettings[] = [];
    const sync: SettingsSync = {
      load: async () => undefined,
      save: async (s) => void saved.push(s),
    };
    const store = new SettingsStore(memory(), sync, 800);
    for (const fov of [72, 75, 80])
      store.set(mine({ look: { sensitivity: 1, invertY: false, fov } }));
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(900);
    expect(saved.map((s) => s.look.fov)).toEqual([80]);
  });

  it("takes the account's copy on a new device when it is newer, and offers its own when it is newer", async () => {
    const remote = { settings: mine({ locale: 'hi' }), updatedAt: '2026-10-17T10:00:00.000Z' };
    const saved: PlayerSettings[] = [];
    const sync: SettingsSync = { load: async () => remote, save: async (s) => void saved.push(s) };

    const fresh = new SettingsStore(memory(), sync, 100);
    await fresh.fromAccount();
    expect(fresh.current.locale).toBe('hi');

    const storage = memory();
    storage.data.set(
      'heist.settings.v1',
      JSON.stringify({ settings: mine({ locale: 'en' }), updatedAt: '2026-10-18T10:00:00.000Z' }),
    );
    const newer = new SettingsStore(storage, sync, 100);
    await newer.fromAccount();
    expect(newer.current.locale).toBe('en'); // this browser is newer
    await vi.advanceTimersByTimeAsync(200);
    expect(saved.at(-1)?.locale).toBe('en'); // and the account is updated
  });

  it('keeps going when the account cannot be reached', async () => {
    const sync: SettingsSync = {
      load: async () => {
        throw new Error('offline');
      },
      save: async () => {
        throw new Error('offline');
      },
    };
    const store = new SettingsStore(memory(), sync, 10);
    await store.fromAccount();
    store.set(mine({ locale: 'hi' }));
    await vi.advanceTimersByTimeAsync(50);
    expect(store.current.locale).toBe('hi');
  });
});
