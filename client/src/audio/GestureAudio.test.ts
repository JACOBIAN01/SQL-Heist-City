import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO_SETTINGS } from '@heist/shared';
import { FakeAudioContext } from '../testing/FakeAudioContext';
import { GestureAudio } from './GestureAudio';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function setup(storage = new MemoryStorage(), startMuted = false) {
  const contexts: FakeAudioContext[] = [];
  const audio = new GestureAudio(
    DEFAULT_AUDIO_SETTINGS,
    () => {
      const ctx = new FakeAudioContext();
      contexts.push(ctx);
      return ctx.asContext();
    },
    storage,
    startMuted,
  );
  return { audio, contexts, storage };
}

describe('GestureAudio', () => {
  it('stays silent until the first gesture, then plays', () => {
    const { audio, contexts } = setup();
    audio.play('hit');
    expect(audio.loop('wind')).toBeUndefined();
    expect(contexts).toHaveLength(0);
    audio.start();
    audio.start(); // later gestures reuse the one context
    expect(contexts).toHaveLength(1);
    audio.play('hit');
    expect(contexts[0]?.playing).toHaveLength(1);
    expect(audio.loop('wind')).toBeDefined();
  });

  it('remembers muting between visits', () => {
    const first = setup();
    first.audio.start();
    expect(first.audio.toggleMute()).toBe(true);
    const again = setup(first.storage);
    expect(again.audio.muted).toBe(true);
    expect(setup(new MemoryStorage(), true).audio.muted).toBe(true); // ?mute
  });

  it('keeps the game going in a browser without audio', () => {
    const audio = new GestureAudio(DEFAULT_AUDIO_SETTINGS, () => {
      throw new Error('no AudioContext');
    });
    audio.start();
    expect(audio.started).toBe(false);
    expect(() => audio.play('hit')).not.toThrow();
  });
});
