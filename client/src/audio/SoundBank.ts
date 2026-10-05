import { SOUND_NAMES, SYNTH_RATE, synthesise, type SoundName } from './synth';

/** The part of an AudioContext a bank needs to turn samples into playable buffers. */
export interface BufferFactory {
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
}

/**
 * Where sounds come from.
 * Pattern: Strategy — Why: the stand-in sounds are generated in code; real
 * recordings can replace them later as another bank (decoding files)
 * without anything that plays sounds changing.
 */
export interface SoundBank {
  /** One variation of a sound (wrapping around), or undefined if the bank has none. */
  get(name: SoundName, variation: number): AudioBuffer | undefined;
  variations(name: SoundName): number;
}

/** Every sound made in code (see synth.ts), rendered once into buffers. */
export class SynthSoundBank implements SoundBank {
  private readonly buffers = new Map<SoundName, AudioBuffer[]>();

  constructor(factory: BufferFactory, names: readonly SoundName[] = SOUND_NAMES) {
    for (const name of names) {
      this.buffers.set(
        name,
        synthesise(name).map((pcm) => {
          const buffer = factory.createBuffer(1, pcm.length, SYNTH_RATE);
          buffer.getChannelData(0).set(pcm);
          return buffer;
        }),
      );
    }
  }

  get(name: SoundName, variation: number): AudioBuffer | undefined {
    const list = this.buffers.get(name);
    if (!list?.length) return undefined;
    return list[((variation % list.length) + list.length) % list.length];
  }

  variations(name: SoundName): number {
    return this.buffers.get(name)?.length ?? 0;
  }
}
