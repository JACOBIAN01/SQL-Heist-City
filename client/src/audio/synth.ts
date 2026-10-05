/**
 * Every game sound, made from maths instead of recordings: plain sample
 * arrays (no Web Audio here), so they can be tested anywhere and cost
 * nothing to download. They are stand-ins: recordings can replace any of
 * them later behind the SoundBank interface.
 */

/** Samples per second for every generated sound: plenty for game effects, half the work of 48 kHz. */
export const SYNTH_RATE = 24_000;

export const STEP_SURFACES = ['concrete', 'tile', 'metal'] as const;
export type StepSurface = (typeof STEP_SURFACES)[number];

export const SOUND_NAMES = [
  'step-concrete',
  'step-tile',
  'step-metal',
  'shot-pistol',
  'shot-smg',
  'shot-shotgun',
  'shot-rifle',
  'shot-sniper',
  'dry-fire',
  'hit',
  'hurt',
  'crash',
  'cash',
  'bank',
  'engine',
  'wind',
  'siren',
  'alarm',
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

/** Sounds made to repeat seamlessly (engines, wind, sirens, alarms). */
export const LOOPS: ReadonlySet<SoundName> = new Set(['engine', 'wind', 'siren', 'alarm']);

type Rng = () => number;

/** Small seeded generator (mulberry32): the same sounds every time the page loads. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const samples = (seconds: number) => new Float32Array(Math.round(seconds * SYNTH_RATE));
const TAU = Math.PI * 2;

function noise(length: number, rng: Rng): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** One-pole low-pass, in place. */
function lowpass(buf: Float32Array, hz: number): Float32Array {
  const k = 1 - Math.exp((-TAU * hz) / SYNTH_RATE);
  let y = 0;
  for (let i = 0; i < buf.length; i++) buf[i] = y += k * ((buf[i] as number) - y);
  return buf;
}

/** One-pole high-pass, in place. */
function highpass(buf: Float32Array, hz: number): Float32Array {
  const k = 1 - Math.exp((-TAU * hz) / SYNTH_RATE);
  let low = 0;
  for (let i = 0; i < buf.length; i++) {
    low += k * ((buf[i] as number) - low);
    buf[i] = (buf[i] as number) - low;
  }
  return buf;
}

/** Resonant band-pass (a biquad): noise through it rings like struck metal. Returns a new array. */
function bandpass(input: Float32Array, hz: number, q: number): Float32Array {
  const w = (TAU * hz) / SYNTH_RATE;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i] as number;
    const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    [x2, x1, y2, y1] = [x1, x, y1, y];
  }
  return out;
}

/** Sharp attack, exponential decay with time constant `tau` (s), starting `delay` seconds in. */
function envelope(buf: Float32Array, attack: number, tau: number, delay = 0): Float32Array {
  for (let i = 0; i < buf.length; i++) {
    const t = i / SYNTH_RATE - delay;
    buf[i] =
      t < 0
        ? 0
        : (buf[i] as number) * Math.min(1, attack > 0 ? t / attack : 1) * Math.exp(-t / tau);
  }
  return buf;
}

/** A sine whose pitch slides from `from` to `to` Hz over `glide` seconds, then holds. */
function sweep(length: number, from: number, to: number, glide: number): Float32Array {
  const out = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = Math.min(1, i / SYNTH_RATE / glide);
    phase += (TAU * (from + (to - from) * t)) / SYNTH_RATE;
    out[i] = Math.sin(phase);
  }
  return out;
}

function tone(length: number, hz: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.sin((TAU * hz * i) / SYNTH_RATE);
  return out;
}

function mixInto(target: Float32Array, source: Float32Array, gain: number, offset = 0): void {
  for (let i = 0; i < source.length && i + offset < target.length; i++)
    target[i + offset] = (target[i + offset] as number) + (source[i] as number) * gain;
}

/** Scales so the loudest sample is `peak`. */
function normalise(buf: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < buf.length; i++) buf[i] = ((buf[i] as number) / max) * peak;
  return buf;
}

/** Gentle saturation: makes a bang punchier without hard clipping. */
function saturate(buf: Float32Array, drive: number): Float32Array {
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh((buf[i] as number) * drive);
  return buf;
}

/** Filters a loop as if it had always been playing, so its end runs into its start without a click. */
function circular(buf: Float32Array, filter: (b: Float32Array) => Float32Array): Float32Array {
  const twice = new Float32Array(buf.length * 2);
  twice.set(buf);
  twice.set(buf, buf.length);
  return filter(twice).slice(buf.length);
}

const vary = (rng: Rng, amount: number) => 1 + (rng() * 2 - 1) * amount;

function step(surface: StepSurface, rng: Rng): Float32Array {
  const out = samples(surface === 'metal' ? 0.22 : 0.12);
  const scuff = noise(out.length, rng);
  if (surface === 'metal') {
    // A short scuff plus the ringing of a metal tread.
    envelope(lowpass(highpass(scuff, 800), 5000), 0.001, 0.012);
    mixInto(out, scuff, 0.6);
    for (const hz of [1150, 1870, 2930]) {
      const ring = envelope(bandpass(noise(out.length, rng), hz * vary(rng, 0.05), 40), 0, 0.07);
      mixInto(out, ring, 1.5);
    }
  } else {
    const bright = surface === 'tile' ? 4200 : 1900;
    envelope(lowpass(highpass(scuff, 250), bright * vary(rng, 0.15)), 0.002, 0.016);
    mixInto(out, scuff, 1);
    // The heel's low thump.
    mixInto(out, envelope(tone(out.length, 85 * vary(rng, 0.1)), 0.002, 0.022), 0.5);
  }
  return normalise(out, 0.5 * vary(rng, 0.15));
}

interface GunVoice {
  readonly seconds: number;
  /** The crack: how bright and how short. */
  readonly crack: number;
  readonly crackTau: number;
  /** The boom: lowest pitch (Hz) and how long it lasts. */
  readonly boom: number;
  readonly boomTau: number;
  readonly boomGain: number;
  /** The rumble of the shot in the street. */
  readonly tailTau: number;
}

const GUNS: Readonly<Record<string, GunVoice>> = {
  pistol: {
    seconds: 0.5,
    crack: 6000,
    crackTau: 0.012,
    boom: 110,
    boomTau: 0.06,
    boomGain: 0.8,
    tailTau: 0.09,
  },
  smg: {
    seconds: 0.35,
    crack: 5200,
    crackTau: 0.008,
    boom: 140,
    boomTau: 0.04,
    boomGain: 0.6,
    tailTau: 0.06,
  },
  shotgun: {
    seconds: 0.8,
    crack: 3200,
    crackTau: 0.022,
    boom: 65,
    boomTau: 0.12,
    boomGain: 1.2,
    tailTau: 0.2,
  },
  rifle: {
    seconds: 0.7,
    crack: 7500,
    crackTau: 0.01,
    boom: 90,
    boomTau: 0.08,
    boomGain: 0.9,
    tailTau: 0.15,
  },
  sniper: {
    seconds: 1.1,
    crack: 9000,
    crackTau: 0.014,
    boom: 58,
    boomTau: 0.15,
    boomGain: 1.2,
    tailTau: 0.32,
  },
};

function gunshot(voice: GunVoice, rng: Rng): Float32Array {
  const out = samples(voice.seconds);
  const crack = envelope(
    lowpass(noise(out.length, rng), voice.crack * vary(rng, 0.1)),
    0.0004,
    voice.crackTau,
  );
  mixInto(out, crack, 1);
  const body = envelope(lowpass(noise(out.length, rng), 700), 0.002, voice.tailTau);
  mixInto(out, body, 1.6);
  const boom = envelope(
    sweep(out.length, voice.boom * 2.5, voice.boom, 0.04),
    0.001,
    voice.boomTau,
  );
  mixInto(out, boom, voice.boomGain);
  return normalise(saturate(normalise(out, 1), 2.2), 0.95);
}

function dryFire(rng: Rng): Float32Array {
  const out = samples(0.12);
  const click = () => envelope(highpass(noise(out.length, rng), 2500), 0, 0.003);
  mixInto(out, click(), 1);
  mixInto(out, click(), 0.6, Math.round(0.045 * SYNTH_RATE));
  return normalise(out, 0.45);
}

function hitTick(): Float32Array {
  const out = samples(0.12);
  mixInto(out, envelope(tone(out.length, 1900), 0.001, 0.025), 1);
  mixInto(out, envelope(tone(out.length, 2850), 0.001, 0.015), 0.5);
  return normalise(out, 0.4);
}

function hurt(rng: Rng): Float32Array {
  const out = samples(0.35);
  mixInto(out, envelope(sweep(out.length, 160, 60, 0.08), 0.002, 0.08), 1);
  mixInto(out, envelope(lowpass(noise(out.length, rng), 900), 0.001, 0.05), 0.8);
  return normalise(saturate(out, 1.5), 0.7);
}

function crash(rng: Rng): Float32Array {
  const out = samples(1);
  mixInto(out, envelope(lowpass(noise(out.length, rng), 1400), 0.002, 0.22), 1);
  mixInto(out, envelope(sweep(out.length, 120, 50, 0.1), 0.002, 0.2), 1.2);
  // Bent metal and glass.
  for (const hz of [820, 1330, 2470])
    mixInto(out, envelope(bandpass(noise(out.length, rng), hz, 25), 0.003, 0.25), 2);
  mixInto(out, envelope(highpass(noise(out.length, rng), 4000), 0.001, 0.12, 0.03), 0.4);
  return normalise(saturate(normalise(out, 1), 1.8), 0.9);
}

/** Notes (Hz) played one after another, each `gap` seconds apart, ringing for `tau`. */
function chime(notes: readonly number[], gap: number, tau: number, seconds: number): Float32Array {
  const out = samples(seconds);
  notes.forEach((hz, i) => {
    const note = envelope(tone(out.length, hz), 0.003, tau);
    mixInto(note, envelope(tone(out.length, hz * 2), 0.003, tau / 2), 0.25);
    mixInto(out, note, 1, Math.round(i * gap * SYNTH_RATE));
  });
  return normalise(out, 0.45);
}

/**
 * Idle engine, one loop of 0.5 s. Every pitch in it repeats a whole number
 * of times per loop (40 Hz firing, 2 Hz steps), so it loops without a seam;
 * the car's speed then raises its playback rate.
 */
function engine(rng: Rng): Float32Array {
  const out = samples(0.5);
  const firing = 40;
  for (let i = 0; i < out.length; i++) {
    const t = i / SYNTH_RATE;
    const saw = 2 * ((firing * t) % 1) - 1;
    const pulse = Math.max(0, Math.sin(TAU * firing * 2 * t)) ** 3;
    out[i] = 0.6 * saw + 0.5 * Math.sin(TAU * firing * 2 * t) + pulse * (rng() * 2 - 1) * 0.8;
  }
  return normalise(
    circular(out, (b) => lowpass(b, 750)),
    0.5,
  );
}

/** Wind, 4 s: filtered noise whose brightness and loudness swell once per loop. */
function wind(rng: Rng): Float32Array {
  const raw = noise(samples(4).length, rng);
  const out = circular(raw, (b) => {
    // A low-pass whose cutoff drifts with a slow swell.
    let y = 0;
    for (let i = 0; i < b.length; i++) {
      const swell = 0.5 + 0.5 * Math.sin((TAU * i) / raw.length);
      const k = 1 - Math.exp((-TAU * (180 + 520 * swell)) / SYNTH_RATE);
      b[i] = y += k * ((b[i] as number) - y);
    }
    return b;
  });
  for (let i = 0; i < out.length; i++)
    out[i] = (out[i] as number) * (0.55 + 0.45 * Math.sin((TAU * i) / out.length + 1));
  return normalise(out, 0.5);
}

/**
 * Police siren wail, 2 s: pitch up and back down. The average pitch times the
 * length is a whole number of cycles, so the wave meets itself at the seam.
 */
function siren(): Float32Array {
  const out = samples(2);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length;
    const tri = t < 0.5 ? t * 2 : 2 - t * 2;
    phase += (TAU * (650 + 650 * tri)) / SYNTH_RATE;
    out[i] = Math.sin(phase) + 0.3 * Math.sin(phase * 3);
  }
  return normalise(out, 0.4);
}

/** Bank alarm bell, 1 s: a hammer striking 16 times a second, each strike ringing on. */
function alarm(): Float32Array {
  const loop = samples(1).length;
  const out = new Float32Array(loop * 2);
  const period = loop / 16;
  for (let strike = 0; strike < 32; strike++) {
    const start = Math.round(strike * period);
    for (let i = start; i < out.length; i++) {
      const t = (i - start) / SYNTH_RATE;
      const decay = Math.exp(-t / 0.05);
      if (decay < 1e-3) break;
      out[i] =
        (out[i] as number) + decay * (Math.sin(TAU * 1250 * t) + 0.5 * Math.sin(TAU * 3110 * t));
    }
  }
  // The second second has the earlier strikes' ringing in it, as the first never would.
  return normalise(out.slice(loop), 0.45);
}

/** How many variations of each sound: repeated sounds (steps, shots) vary so they never sound canned. */
export const VARIANTS: Readonly<Record<SoundName, number>> = {
  'step-concrete': 4,
  'step-tile': 4,
  'step-metal': 3,
  'shot-pistol': 2,
  'shot-smg': 3,
  'shot-shotgun': 2,
  'shot-rifle': 2,
  'shot-sniper': 1,
  'dry-fire': 1,
  hit: 1,
  hurt: 2,
  crash: 2,
  cash: 1,
  bank: 1,
  engine: 1,
  wind: 1,
  siren: 1,
  alarm: 1,
};

const gun = (id: string): GunVoice => GUNS[id] as GunVoice;

const RECIPES: Readonly<Record<SoundName, (rng: Rng) => Float32Array>> = {
  'step-concrete': (rng) => step('concrete', rng),
  'step-tile': (rng) => step('tile', rng),
  'step-metal': (rng) => step('metal', rng),
  'shot-pistol': (rng) => gunshot(gun('pistol'), rng),
  'shot-smg': (rng) => gunshot(gun('smg'), rng),
  'shot-shotgun': (rng) => gunshot(gun('shotgun'), rng),
  'shot-rifle': (rng) => gunshot(gun('rifle'), rng),
  'shot-sniper': (rng) => gunshot(gun('sniper'), rng),
  'dry-fire': dryFire,
  hit: hitTick,
  hurt,
  crash,
  cash: () => chime([1318.5, 1760], 0.07, 0.12, 0.4),
  bank: () => chime([1046.5, 1318.5, 1568, 2093], 0.075, 0.18, 0.8),
  engine,
  wind,
  siren,
  alarm,
};

const made = new Map<SoundName, Float32Array[]>();

/** Every variation of one sound, the same on every call (seeded by name and variation; made once). */
export function synthesise(name: SoundName): Float32Array[] {
  let list = made.get(name);
  if (!list) {
    const seedBase = [...name].reduce(
      (h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619),
      2166136261,
    );
    list = Array.from({ length: VARIANTS[name] }, (_, v) => RECIPES[name](seeded(seedBase + v)));
    made.set(name, list);
  }
  return list;
}

/**
 * Makes every sound ahead of time, one per idle moment (~90 ms in all), so
 * the first click that turns sound on does not stall a frame.
 */
export function prepareSounds(schedule: (work: () => void) => void): void {
  const queue = [...SOUND_NAMES];
  const next = () => {
    const name = queue.shift();
    if (!name) return;
    synthesise(name);
    schedule(next);
  };
  schedule(next);
}
