import { describe, expect, it, vi } from 'vitest';
import { en, type MessageKey } from '../i18n/en';
import type { SoundName } from './synth';
import { CAPTION_TEXT, CaptionedAudio, bearingOf, type Caption } from './CaptionedAudio';
import type { AudioOut } from './AudioEngine';
import { SOUND_NAMES } from './synth';

const here = { x: 0, y: 0, z: 0 };
const north = { x: 0, y: 0, z: -1 }; // facing −z

describe('sound captions (22.3)', () => {
  it('has an English catalog entry for every captioned sound', () => {
    for (const name of Object.keys(CAPTION_TEXT))
      expect(en[`caption.${name}` as MessageKey], name).toBe(CAPTION_TEXT[name as SoundName]);
  });

  it('says which way a sound is, from where the player faces', () => {
    expect(bearingOf(here, north, { x: 0, y: 0, z: -20 })).toBe('ahead');
    expect(bearingOf(here, north, { x: 0, y: 0, z: 20 })).toBe('behind');
    expect(bearingOf(here, north, { x: 20, y: 0, z: 0 })).toBe('right');
    expect(bearingOf(here, north, { x: -20, y: 0, z: 0 })).toBe('left');
    // Turn to face east: the same sound is now on the left.
    expect(bearingOf(here, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -20 })).toBe('left');
  });

  function setup(enabled = true, t = { now: 0 }) {
    const inner: AudioOut = {
      play: vi.fn(),
      loop: vi.fn(() => undefined),
      setListener: vi.fn(),
      now: 0,
    };
    const shown: Caption[] = [];
    const audio = new CaptionedAudio(
      inner,
      (c) => shown.push(c),
      () => enabled,
      () => t.now,
    );
    audio.setListener(here, north, { x: 0, y: 1, z: 0 });
    return { audio, inner, shown, t };
  }

  it('writes down a gunshot with its direction and distance, and still plays it', () => {
    const { audio, inner, shown } = setup();
    audio.play('shot-rifle', { at: { x: 33, y: 0, z: 0 } });
    expect(shown).toEqual([
      { text: 'Rifle shot', key: 'caption.shot-rifle', bearing: 'right', metres: 35 },
    ]);
    expect(inner.play).toHaveBeenCalledWith('shot-rifle', { at: { x: 33, y: 0, z: 0 } });
  });

  it('writes nothing when switched off, for far-off sounds, or for sounds not worth it', () => {
    const off = setup(false);
    off.audio.play('alarm', { at: { x: 5, y: 0, z: 5 } });
    expect(off.shown).toEqual([]);
    expect(off.inner.play).toHaveBeenCalled();
    const on = setup();
    on.audio.play('shot-pistol', { at: { x: 400, y: 0, z: 0 } });
    on.audio.play('step-concrete', { at: { x: 2, y: 0, z: 0 } });
    on.audio.play('wind');
    expect(on.shown).toEqual([]);
  });

  it('does not repeat the same caption in a rush, and captions loops once at the start', () => {
    const { audio, shown, t } = setup();
    for (let i = 0; i < 5; i++) {
      audio.play('shot-smg', { at: { x: 0, y: 0, z: -10 } });
      t.now += 100;
    }
    expect(shown).toHaveLength(1);
    t.now += 1000;
    audio.play('shot-smg', { at: { x: 0, y: 0, z: -10 } });
    expect(shown).toHaveLength(2);
    audio.loop('siren', { at: { x: 0, y: 0, z: 30 } });
    expect(shown.at(-1)).toMatchObject({ text: 'Siren', bearing: 'behind' });
  });

  it('a sound with no place (your own gun, a chime) has no direction', () => {
    const { audio, shown } = setup();
    audio.play('hurt');
    expect(shown).toEqual([{ text: 'You are hit', key: 'caption.hurt' }]);
  });

  it('only names sounds that exist', () => {
    for (const name of Object.keys(CAPTION_TEXT))
      expect(SOUND_NAMES as readonly string[]).toContain(name);
  });
});
