import { describe, expect, it } from 'vitest';
import { SynthSoundBank, type BufferFactory } from './SoundBank';
import { LOOPS, SOUND_NAMES, SYNTH_RATE, synthesise, VARIANTS, type SoundName } from './synth';

const all = new Map<SoundName, Float32Array[]>(SOUND_NAMES.map((n) => [n, synthesise(n)]));
const peak = (pcm: Float32Array) => pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (pcm: Float32Array, from = 0, to = pcm.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += (pcm[i] as number) ** 2;
  return Math.sqrt(sum / (to - from));
};

describe('synthesised sounds', () => {
  it('makes every variation of every sound: audible, finite, never clipping', () => {
    for (const name of SOUND_NAMES) {
      const list = all.get(name) ?? [];
      expect(list, name).toHaveLength(VARIANTS[name]);
      for (const pcm of list) {
        expect(pcm.length, name).toBeGreaterThan(0.05 * SYNTH_RATE);
        expect(pcm.every(Number.isFinite), name).toBe(true);
        expect(peak(pcm), name).toBeLessThanOrEqual(1);
        expect(peak(pcm), name).toBeGreaterThan(0.2);
      }
    }
  });

  it('is the same on every load, and varies between variations', () => {
    expect(synthesise('step-concrete')).toEqual(all.get('step-concrete'));
    const [a, b] = all.get('step-concrete') ?? [];
    expect(a).not.toEqual(b);
  });

  it('dies away: one-shot sounds end near silence', () => {
    for (const name of SOUND_NAMES) {
      if (LOOPS.has(name)) continue;
      for (const pcm of all.get(name) ?? []) {
        const tail = rms(pcm, Math.floor(pcm.length * 0.95));
        expect(tail, name).toBeLessThan(0.05);
      }
    }
  });

  it('loops without a click: a loop’s end runs smoothly into its start', () => {
    for (const name of LOOPS) {
      const pcm = (all.get(name) ?? [])[0] as Float32Array;
      const jump = Math.abs((pcm[0] as number) - (pcm[pcm.length - 1] as number));
      // No bigger than the biggest step inside the loop itself.
      let biggest = 0;
      for (let i = 1; i < pcm.length; i++)
        biggest = Math.max(biggest, Math.abs((pcm[i] as number) - (pcm[i - 1] as number)));
      expect(jump, name).toBeLessThanOrEqual(biggest + 1e-6);
      // And it keeps sounding to the very end.
      expect(rms(pcm, Math.floor(pcm.length * 0.9)), name).toBeGreaterThan(0.02);
    }
  });

  it('gives bigger guns longer, heavier shots', () => {
    const length = (n: SoundName) => (all.get(n) ?? [])[0]?.length ?? 0;
    expect(length('shot-sniper')).toBeGreaterThan(length('shot-rifle'));
    expect(length('shot-rifle')).toBeGreaterThan(length('shot-smg'));
    const low = (n: SoundName) => {
      // Energy in the first 100 ms after a heavy low-pass: the boom.
      const pcm = Float32Array.from((all.get(n) ?? [])[0] ?? []);
      let y = 0;
      for (let i = 0; i < pcm.length; i++) pcm[i] = y += 0.02 * ((pcm[i] as number) - y);
      return rms(pcm, 0, 0.1 * SYNTH_RATE);
    };
    expect(low('shot-shotgun')).toBeGreaterThan(low('shot-smg'));
  });

  it('stays small: under 2 s of samples for most sounds, about 2 MB in memory all told', () => {
    let total = 0;
    for (const list of all.values()) for (const pcm of list) total += pcm.length;
    expect(total * 4).toBeLessThan(2.5e6);
  });
});

describe('SynthSoundBank', () => {
  const factory: BufferFactory = {
    createBuffer: (_channels, length, sampleRate) => {
      const data = new Float32Array(length);
      return { length, sampleRate, getChannelData: () => data } as unknown as AudioBuffer;
    },
  };

  it('turns every sound into buffers and wraps variation numbers around', () => {
    const bank = new SynthSoundBank(factory, ['step-concrete', 'hit']);
    expect(bank.variations('step-concrete')).toBe(4);
    const first = bank.get('step-concrete', 0);
    expect(bank.get('step-concrete', 4)).toBe(first);
    expect(bank.get('step-concrete', -4)).toBe(first);
    expect(first?.sampleRate).toBe(SYNTH_RATE);
    expect(first?.getChannelData(0)).toEqual((all.get('step-concrete') ?? [])[0]);
    expect(bank.get('siren', 0)).toBeUndefined();
    expect(bank.variations('siren')).toBe(0);
  });
});
