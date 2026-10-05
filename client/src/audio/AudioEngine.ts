import type { AudioSettings } from '@heist/shared';
import type { SoundBank } from './SoundBank';
import type { SoundName } from './synth';

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PlayOptions {
  /** Where it happens; omitted, it plays in the listener's head (your own gun, UI chimes). */
  readonly at?: Point;
  /** Beyond this (m) it is not played at all. */
  readonly range?: number;
  readonly volume?: number;
  /** Playback speed: 1 as made, higher is faster and higher-pitched. */
  readonly rate?: number;
  /** Which variation; omitted, a random one. */
  readonly variation?: number;
  /** Send some of it into the street echo (gunshots). */
  readonly echo?: boolean;
}

/** A sound that keeps playing until stopped: it can be moved, re-pitched and faded. */
export interface LoopHandle {
  move(at: Point): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  stop(): void;
}

/**
 * What the game needs from audio. GameAudio talks to this, so its rules
 * (what plays when) are tested without a browser's audio stack.
 */
export interface AudioOut {
  play(name: SoundName, options?: PlayOptions): void;
  loop(name: SoundName, options?: PlayOptions): LoopHandle | undefined;
  setListener(at: Point, forward: Point, up: Point): void;
  /** Seconds on the audio clock (the clock sounds are scheduled on). */
  readonly now: number;
}

/** How loud a sound `distance` m away is, 0–1: the inverse-distance fade the panners use. */
export function distanceGain(distance: number, s: AudioSettings): number {
  const d = Math.max(distance, s.refDistance);
  return s.refDistance / (s.refDistance + s.rolloff * (d - s.refDistance));
}

interface Voice {
  readonly ends: number;
  readonly loudness: number;
  readonly source: AudioBufferSourceNode;
}

/** A fade this long (s) when a loop stops or is turned, so nothing clicks. */
const FADE = 0.06;
/** Echo bus brightness (Hz): reflections off buildings lose their highs. */
const ECHO_TONE = 1800;

/**
 * Plays sounds in 3D through Web Audio.
 * Pattern: Facade — Why: the game says "this sound, there"; the panners,
 * gains, echo bus, distance cut-off and voice limit stay in here.
 */
export class AudioEngine implements AudioOut {
  private readonly master: GainNode;
  private readonly echoIn: GainNode;
  private voices: Voice[] = [];
  private listener: Point = { x: 0, y: 0, z: 0 };
  private volume: number;

  constructor(
    private readonly ctx: AudioContext,
    private readonly bank: SoundBank,
    private readonly settings: AudioSettings,
  ) {
    this.volume = settings.volume;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    // The street echo: a delay feeding back on itself through a dull filter.
    this.echoIn = ctx.createGain();
    this.echoIn.gain.value = settings.echoSend;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = settings.echoDelay;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = ECHO_TONE;
    const feedback = ctx.createGain();
    feedback.gain.value = settings.echoFeedback;
    this.echoIn.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(this.master);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  get muted(): boolean {
    return this.master.gain.value === 0;
  }

  setMuted(muted: boolean): void {
    this.master.gain.value = muted ? 0 : this.volume;
  }

  play(name: SoundName, options: PlayOptions = {}): void {
    const loudness = this.loudness(options);
    if (loudness <= 0) return;
    const buffer = this.buffer(name, options.variation);
    if (!buffer) return;
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.ends > now);
    if (this.voices.length >= this.settings.maxVoices) {
      // Full: a louder sound takes the quietest one's place; a quieter one is dropped.
      let quietest = 0;
      for (let i = 1; i < this.voices.length; i++)
        if ((this.voices[i] as Voice).loudness < (this.voices[quietest] as Voice).loudness)
          quietest = i;
      const victim = this.voices[quietest] as Voice;
      if (victim.loudness >= loudness) return;
      victim.source.stop();
      this.voices.splice(quietest, 1);
    }
    const { source } = this.chain(buffer, options);
    source.start();
    const rate = options.rate ?? 1;
    this.voices.push({ ends: now + buffer.duration / rate, loudness, source });
  }

  loop(name: SoundName, options: PlayOptions = {}): LoopHandle | undefined {
    const buffer = this.buffer(name, options.variation ?? 0);
    if (!buffer) return undefined;
    const { source, gain, panner } = this.chain(buffer, options);
    source.loop = true;
    source.start();
    const ctx = this.ctx;
    let stopped = false;
    return {
      move: (at) => panner && place(panner, at),
      setRate: (rate) => source.playbackRate.setTargetAtTime(rate, ctx.currentTime, FADE),
      setVolume: (volume) => gain.gain.setTargetAtTime(volume, ctx.currentTime, FADE),
      stop: () => {
        if (stopped) return;
        stopped = true;
        gain.gain.setTargetAtTime(0, ctx.currentTime, FADE);
        source.stop(ctx.currentTime + FADE * 5);
      },
    };
  }

  setListener(at: Point, forward: Point, up: Point): void {
    this.listener = at;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = at.x;
      l.positionY.value = at.y;
      l.positionZ.value = at.z;
      l.forwardX.value = forward.x;
      l.forwardY.value = forward.y;
      l.forwardZ.value = forward.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    } else {
      // Older Safari has only the deprecated setters.
      l.setPosition(at.x, at.y, at.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /** How loud the sound will be where the listener is (0 = out of earshot). */
  private loudness(options: PlayOptions): number {
    const volume = options.volume ?? 1;
    if (!options.at) return volume;
    const d = Math.hypot(
      options.at.x - this.listener.x,
      options.at.y - this.listener.y,
      options.at.z - this.listener.z,
    );
    if (options.range !== undefined && d > options.range) return 0;
    return volume * distanceGain(d, this.settings);
  }

  private buffer(name: SoundName, variation: number | undefined): AudioBuffer | undefined {
    const count = this.bank.variations(name);
    if (count === 0) return undefined;
    return this.bank.get(name, variation ?? Math.floor(Math.random() * count));
  }

  /** source → gain → (panner) → master, and into the echo if asked. */
  private chain(buffer: AudioBuffer, options: PlayOptions) {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.rate ?? 1;
    const gain = ctx.createGain();
    gain.gain.value = options.volume ?? 1;
    source.connect(gain);
    let out: AudioNode = gain;
    let panner: PannerNode | undefined;
    if (options.at) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = this.settings.refDistance;
      panner.rolloffFactor = this.settings.rolloff;
      panner.maxDistance = options.range ?? 10_000;
      place(panner, options.at);
      gain.connect(panner);
      out = panner;
    }
    out.connect(this.master);
    if (options.echo) out.connect(this.echoIn);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      panner?.disconnect();
    };
    return { source, gain, panner };
  }
}

function place(panner: PannerNode, at: Point): void {
  if (panner.positionX) {
    panner.positionX.value = at.x;
    panner.positionY.value = at.y;
    panner.positionZ.value = at.z;
  } else panner.setPosition(at.x, at.y, at.z);
}
