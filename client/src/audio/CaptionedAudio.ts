import type { AudioOut, Channel, LoopHandle, PlayOptions, Point } from './AudioEngine';
import type { MessageKey } from '../i18n/en';
import type { SoundName } from './synth';

/** What each sound is called in a caption. Footsteps and wind are not captioned. */
export const CAPTION_TEXT: Readonly<Partial<Record<SoundName, string>>> = {
  'shot-pistol': 'Pistol shot',
  'shot-smg': 'Machine gun fire',
  'shot-shotgun': 'Shotgun blast',
  'shot-rifle': 'Rifle shot',
  'shot-sniper': 'Sniper shot',
  'dry-fire': 'Gun clicks empty',
  hurt: 'You are hit',
  hit: 'You hit someone',
  crash: 'Car crash',
  cash: 'Cash',
  bank: 'Cash banked',
  engine: 'Car engine',
  siren: 'Siren',
  alarm: 'Alarm',
  'vault-crack': 'Vault lock cracking',
  'vault-open': 'Vault opens',
};

/** Which way a sound is, from where the listener faces. */
export type Bearing = 'ahead' | 'behind' | 'left' | 'right';

export interface Caption {
  readonly text: string;
  /** The catalog entry for the text, so the view can show it in the player's language. */
  readonly key?: MessageKey;
  readonly bearing?: Bearing;
  /** Metres, rounded to 5. */
  readonly metres?: number;
}

/** Where `at` is, seen from `listener` facing `forward` (x, z on the ground). */
export function bearingOf(listener: Point, forward: Point, at: Point): Bearing {
  const dx = at.x - listener.x;
  const dz = at.z - listener.z;
  // Forward and the vector to the sound, as angles on the ground; right is clockwise from above.
  const angle = Math.atan2(forward.x * dz - forward.z * dx, forward.x * dx + forward.z * dz);
  const a = Math.abs(angle);
  if (a < Math.PI / 4) return 'ahead';
  if (a > (3 * Math.PI) / 4) return 'behind';
  return angle > 0 ? 'right' : 'left';
}

/**
 * Writes down the sounds that matter, for players who cannot hear them (Phase 22.3). A sound
 * heard in the world says which way it came from and how far; the same sound is not written
 * again for `minGapMs`.
 *
 * Pattern: Decorator — Why: the audio engine and the rules for what plays stay as they were; this
 * only listens in on the calls and passes every one on unchanged.
 */
export class CaptionedAudio implements AudioOut {
  private listener: Point = { x: 0, y: 0, z: 0 };
  private forward: Point = { x: 0, y: 0, z: -1 };
  private readonly last = new Map<SoundName, number>();

  constructor(
    private readonly inner: AudioOut,
    private readonly show: (caption: Caption) => void,
    private readonly enabled: () => boolean,
    private readonly clock: () => number = () => performance.now(),
    private readonly minGapMs = 700,
    /** Sounds further than this are not written down: they would not be heard. */
    private readonly reach = 120,
  ) {}

  get now(): number {
    return this.inner.now;
  }

  setListener(at: Point, forward: Point, up: Point): void {
    this.listener = at;
    this.forward = forward;
    this.inner.setListener(at, forward, up);
  }

  setChannelVolume(channel: Channel, volume: number): void {
    this.inner.setChannelVolume?.(channel, volume);
  }

  play(name: SoundName, options?: PlayOptions): void {
    this.caption(name, options);
    this.inner.play(name, options);
  }

  loop(name: SoundName, options?: PlayOptions): LoopHandle | undefined {
    this.caption(name, options);
    return this.inner.loop(name, options);
  }

  private caption(name: SoundName, options: PlayOptions | undefined): void {
    const text = CAPTION_TEXT[name];
    if (!text || !this.enabled()) return;
    const at = options?.at;
    let metres: number | undefined;
    if (at) {
      const d = Math.hypot(at.x - this.listener.x, at.y - this.listener.y, at.z - this.listener.z);
      if (d > Math.min(this.reach, options?.range ?? Infinity)) return;
      metres = Math.max(5, Math.round(d / 5) * 5);
    }
    const now = this.clock();
    if (now - (this.last.get(name) ?? -Infinity) < this.minGapMs) return;
    this.last.set(name, now);
    this.show({
      text,
      key: `caption.${name}` as MessageKey,
      ...(at && metres !== undefined
        ? { bearing: bearingOf(this.listener, this.forward, at), metres }
        : {}),
    });
  }
}
