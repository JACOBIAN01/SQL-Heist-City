import { Color, Vector3 } from 'three';

/** Everything the scene's light, fog and sky need at one hour of the day. */
export interface SkyState {
  readonly hour: number;
  /** Unit vector toward the sun, which may be below the horizon (for the sky's sun disc). */
  readonly sunDirection: Vector3;
  /** Unit vector toward the light that casts shadows: the sun by day, the moon by night. */
  readonly lightDirection: Vector3;
  readonly lightColor: Color;
  readonly lightIntensity: number;
  readonly skyColor: Color;
  readonly groundColor: Color;
  readonly ambientIntensity: number;
  readonly zenith: Color;
  readonly horizon: Color;
  readonly fogNear: number;
  readonly fogFar: number;
  /** 0 by day, 1 at night: lit windows glow, the sun disc gives way to stars. */
  readonly night: number;
}

interface Key {
  readonly hour: number;
  readonly zenith: number;
  readonly horizon: number;
  readonly light: number;
  readonly lightIntensity: number;
  readonly sky: number;
  readonly ground: number;
  readonly ambient: number;
  readonly night: number;
}

/**
 * The day, as a few keyframes blended in between. Nights stay bright enough
 * to play (moonlight plus a blue ambient); dawn and dusk get the warm light.
 */
const KEYS: readonly Key[] = [
  {
    hour: 0,
    zenith: 0x050a18,
    horizon: 0x161e36,
    light: 0x8fa6d6,
    lightIntensity: 0.45,
    sky: 0x2e3a5a,
    ground: 0x0f0f16,
    ambient: 0.55,
    night: 1,
  },
  {
    hour: 5,
    zenith: 0x0b1430,
    horizon: 0x2c2a44,
    light: 0x8fa6d6,
    lightIntensity: 0.35,
    sky: 0x34405e,
    ground: 0x15131a,
    ambient: 0.55,
    night: 1,
  },
  {
    hour: 6.5,
    zenith: 0x3a5a8c,
    horizon: 0xf0a070,
    light: 0xffb070,
    lightIntensity: 1.1,
    sky: 0x9aa8c8,
    ground: 0x3a2e28,
    ambient: 0.65,
    night: 0.4,
  },
  {
    hour: 9,
    zenith: 0x5f8fc8,
    horizon: 0xb8cce0,
    light: 0xfff1d6,
    lightIntensity: 2.1,
    sky: 0xcfe0ff,
    ground: 0x4a4036,
    ambient: 0.85,
    night: 0,
  },
  {
    hour: 13,
    zenith: 0x4f86c6,
    horizon: 0xa8c2dc,
    light: 0xffffff,
    lightIntensity: 2.4,
    sky: 0xd4e4ff,
    ground: 0x4a4036,
    ambient: 0.9,
    night: 0,
  },
  {
    hour: 17,
    zenith: 0x5a85bd,
    horizon: 0xd0c8c0,
    light: 0xffe6b8,
    lightIntensity: 2.0,
    sky: 0xcfd8f0,
    ground: 0x4a4036,
    ambient: 0.8,
    night: 0,
  },
  {
    hour: 18.5,
    zenith: 0x34406e,
    horizon: 0xf08a5a,
    light: 0xff9a60,
    lightIntensity: 1.0,
    sky: 0x8a7aa0,
    ground: 0x3a2a28,
    ambient: 0.6,
    night: 0.5,
  },
  {
    hour: 20,
    zenith: 0x0d1430,
    horizon: 0x2a2440,
    light: 0x8fa6d6,
    lightIntensity: 0.4,
    sky: 0x323c5c,
    ground: 0x121016,
    ambient: 0.55,
    night: 1,
  },
  {
    hour: 24,
    zenith: 0x050a18,
    horizon: 0x161e36,
    light: 0x8fa6d6,
    lightIntensity: 0.45,
    sky: 0x2e3a5a,
    ground: 0x0f0f16,
    ambient: 0.55,
    night: 1,
  },
];

/** The shadow-casting light never drops below this elevation: a sun at the horizon would make endless shadows. */
const MIN_ELEVATION = 0.25;
/** Tilt of the sun's path toward the south, so noon shadows are not straight down. */
const PATH_TILT = 0.35;
const FOG_DAY = { near: 60, far: 170 } as const;
const FOG_NIGHT = { near: 45, far: 150 } as const;

const color = (a: number, b: number, t: number) => new Color(a).lerp(new Color(b), t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The sky at an hour (0–24). Pure: the same hour always gives the same sky,
 * so tests can pin it and every client agrees.
 */
export function skyAt(hour: number): SkyState {
  const h = ((hour % 24) + 24) % 24;
  const i = Math.max(0, KEYS.findIndex((k) => k.hour > h) - 1);
  const a = KEYS[i] ?? (KEYS[0] as Key);
  const b = KEYS[i + 1] ?? a;
  const t = b.hour === a.hour ? 0 : (h - a.hour) / (b.hour - a.hour);

  // The sun rises in the east at 6, peaks at noon, sets in the west at 18.
  const angle = ((h - 6) / 12) * Math.PI;
  const sunDirection = new Vector3(Math.cos(angle), Math.sin(angle), PATH_TILT).normalize();
  // By night the moon (opposite the sun) casts the shadows.
  const up = sunDirection.y >= 0 ? sunDirection.clone() : sunDirection.clone().negate();
  up.y = Math.max(MIN_ELEVATION, up.y);
  const night = lerp(a.night, b.night, t);
  return {
    hour: h,
    sunDirection,
    lightDirection: up.normalize(),
    lightColor: color(a.light, b.light, t),
    lightIntensity: lerp(a.lightIntensity, b.lightIntensity, t),
    skyColor: color(a.sky, b.sky, t),
    groundColor: color(a.ground, b.ground, t),
    ambientIntensity: lerp(a.ambient, b.ambient, t),
    zenith: color(a.zenith, b.zenith, t),
    horizon: color(a.horizon, b.horizon, t),
    fogNear: lerp(FOG_DAY.near, FOG_NIGHT.near, night),
    fogFar: lerp(FOG_DAY.far, FOG_NIGHT.far, night),
    night,
  };
}
