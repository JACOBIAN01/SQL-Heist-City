import type { AudioSettings } from '@heist/shared';
import {
  AudioEngine,
  type AudioOut,
  type LoopHandle,
  type PlayOptions,
  type Point,
} from './AudioEngine';
import { SynthSoundBank } from './SoundBank';
import type { SoundName } from './synth';

/** Remembered mute choice (a per-browser convenience). */
const MUTE_KEY = 'heist:muted';

/**
 * Browsers only allow sound after the player has clicked or pressed a key.
 * Pattern: Proxy — Why: the game can report sounds from the first frame;
 * until the first gesture they go nowhere, then the real engine (and the
 * sounds, made on that first gesture so page load stays fast) takes over.
 */
export class GestureAudio implements AudioOut {
  private engine: AudioEngine | undefined;
  private ctx: AudioContext | undefined;
  private mutedNow: boolean;

  constructor(
    private readonly settings: AudioSettings,
    private readonly createContext: () => AudioContext = () => new AudioContext(),
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeStorage(),
    startMuted = false,
  ) {
    this.mutedNow = startMuted || readMuted(storage);
  }

  /** Call from a click or key press. Safe to call on every one. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = this.createContext();
    } catch (error) {
      console.warn('no audio in this browser', error);
      return;
    }
    this.engine = new AudioEngine(this.ctx, new SynthSoundBank(this.ctx), this.settings);
    this.engine.setMuted(this.mutedNow);
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get started(): boolean {
    return this.engine !== undefined;
  }

  get muted(): boolean {
    return this.mutedNow;
  }

  toggleMute(): boolean {
    this.mutedNow = !this.mutedNow;
    this.engine?.setMuted(this.mutedNow);
    try {
      this.storage?.setItem(MUTE_KEY, this.mutedNow ? '1' : '0');
    } catch {
      // Storage blocked: the choice lasts for this visit only.
    }
    return this.mutedNow;
  }

  get now(): number {
    return this.engine?.now ?? 0;
  }

  play(name: SoundName, options?: PlayOptions): void {
    this.engine?.play(name, options);
  }

  loop(name: SoundName, options?: PlayOptions): LoopHandle | undefined {
    return this.engine?.loop(name, options);
  }

  setListener(at: Point, forward: Point, up: Point): void {
    this.engine?.setListener(at, forward, up);
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function readMuted(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
