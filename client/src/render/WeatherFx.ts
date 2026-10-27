import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineSegments,
  ShaderMaterial,
  type Camera,
  type Fog,
  type Scene,
} from 'three';
import { WEATHER_KINDS, type Weather, type WeatherKind, type WeatherSettings } from '@heist/shared';
import type { Lighting } from './lighting';

/** Half the width of the box of rain around you, and its height (m). */
const BOX = 22;
const HEIGHT = 20;
const FALL_SPEED = 16;
const STREAK = 0.7;
/** Rain and fog grey the sky down; how much of the horizon colour is replaced at full fog. */
const GREY = new Color(0x8a9097);
const GREY_MIX = 0.8;

const VERTEX = /* glsl */ `
  attribute float aTip;
  uniform float uTime;
  uniform float uSlant;
  void main() {
    vec3 p = position;
    p.y = mod(p.y - uTime * ${FALL_SPEED.toFixed(1)}, ${HEIGHT.toFixed(1)}) - ${(HEIGHT / 2).toFixed(1)};
    p.x -= aTip * ${STREAK.toFixed(2)} * uSlant;
    p.y += aTip * ${STREAK.toFixed(2)};
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const FRAGMENT = /* glsl */ `
  uniform float uAlpha;
  void main() { gl_FragColor = vec4(0.78, 0.85, 0.95, uAlpha); }
`;

const PINNED: Record<WeatherKind, Weather> = {
  clear: { rain: 0, fog: 0, kind: 'clear' },
  fog: { rain: 0, fog: 1, kind: 'fog' },
  rain: { rain: 0.6, fog: 0.35, kind: 'rain' },
  storm: { rain: 1, fog: 0.6, kind: 'storm' },
};

/** The weather a `?weather=` page address asks for, or the real one when it asks for none. */
export function pinnedWeather(pin: string | null, real: Weather): Weather {
  const kind = WEATHER_KINDS.find((k) => k === pin);
  return kind ? PINNED[kind] : real;
}

/**
 * Rain and fog (Phase 29.5). Draws streaks in one box that follows the camera (one draw call, the
 * fall done in the vertex shader) and pulls the fog in and greys it. Scenery only: the weather
 * comes from the server clock, so everyone sees the same sky, and nothing here touches gameplay.
 * Pattern: Decorator — Why: it adjusts the lighting's fog after the sky has set it, so the day/night
 * code does not need to know weather exists.
 */
export class WeatherFx {
  readonly rain: LineSegments;
  private readonly material: ShaderMaterial;
  private readonly alpha = { value: 0 };
  private readonly clock = { value: 0 };
  private weather: Weather = { rain: 0, fog: 0, kind: 'clear' };
  private time = 0;
  private readonly drops: number;

  constructor(
    private readonly scene: Scene,
    private readonly lighting: Lighting,
    private readonly settings: WeatherSettings,
  ) {
    this.drops = settings.rainDrops;
    const positions = new Float32Array(this.drops * 6);
    const tips = new Float32Array(this.drops * 2);
    // A fixed scatter: the same on every client is not needed, only that it looks even.
    let seed = 12345;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < this.drops; i++) {
      const x = (rnd() * 2 - 1) * BOX;
      const y = rnd() * HEIGHT;
      const z = (rnd() * 2 - 1) * BOX;
      positions.set([x, y, z, x, y, z], i * 6);
      tips[i * 2 + 1] = 1;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aTip', new BufferAttribute(tips, 1));
    geometry.setDrawRange(0, 0);
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: this.clock, uAlpha: this.alpha, uSlant: { value: 0.25 } },
    });
    this.rain = new LineSegments(geometry, this.material);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.name = 'rain';
    scene.add(this.rain);
  }

  /** The weather now (from the match clock). */
  set(weather: Weather): void {
    this.weather = weather;
  }

  /** Call every frame, after the lighting has been applied. */
  frame(dt: number, camera: Camera): void {
    const { rain, fog } = this.weather;
    this.time += dt;
    const sky = this.lighting.state;
    const sceneFog = this.scene.fog as Fog | null;
    if (sceneFog) {
      const reach = 1 + (this.settings.fogVisibility - 1) * Math.max(fog, rain * 0.5);
      sceneFog.near = sky.fogNear * reach;
      sceneFog.far = sky.fogFar * reach;
      const grey = GREY_MIX * Math.max(fog, rain) * (1 - sky.night);
      sceneFog.color.copy(sky.horizon).lerp(GREY, grey);
      // The sky greys too, or fogged buildings would hang against a clear blue.
      const zenith = this.lighting.sky.uniform('uZenith') as Color;
      const horizon = this.lighting.sky.uniform('uHorizon') as Color;
      zenith.copy(sky.zenith).lerp(GREY, grey);
      horizon.copy(sceneFog.color);
    }
    const shown = this.drops > 0 && rain > 0.02;
    this.rain.visible = shown;
    if (!shown) return;
    this.rain.geometry.setDrawRange(0, Math.ceil(this.drops * rain) * 2);
    this.alpha.value = 0.12 + 0.28 * rain;
    this.clock.value = this.time;
    this.rain.position.copy(camera.position);
  }
}
