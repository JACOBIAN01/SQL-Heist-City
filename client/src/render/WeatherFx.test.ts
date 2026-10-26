import { PerspectiveCamera, Scene, type Fog } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ATMOSPHERE_SETTINGS } from '@heist/shared';
import { addLighting } from './lighting';
import { WeatherFx, pinnedWeather } from './WeatherFx';

const cfg = DEFAULT_ATMOSPHERE_SETTINGS.weather;

function make() {
  const scene = new Scene();
  const lighting = addLighting(scene);
  const fx = new WeatherFx(scene, lighting, cfg);
  const camera = new PerspectiveCamera();
  camera.position.set(10, 2, -5);
  return { scene, lighting, fx, camera };
}

describe('WeatherFx', () => {
  it('leaves the sky alone and draws no rain when it is clear', () => {
    const { scene, lighting, fx, camera } = make();
    fx.set({ rain: 0, fog: 0, kind: 'clear' });
    fx.frame(0.016, camera);
    const fog = scene.fog as Fog;
    expect(fog.far).toBe(lighting.state.fogFar);
    expect(fx.rain.visible).toBe(false);
  });

  it('pulls the fog in as it thickens', () => {
    const { scene, lighting, fx, camera } = make();
    fx.set({ rain: 0, fog: 1, kind: 'fog' });
    fx.frame(0.016, camera);
    expect((scene.fog as Fog).far).toBeCloseTo(lighting.state.fogFar * cfg.fogVisibility);
  });

  it('draws more streaks the harder it rains, around the camera, in a single draw call', () => {
    const { fx, camera } = make();
    fx.set({ rain: 0.5, fog: 0, kind: 'rain' });
    fx.frame(0.016, camera);
    const half = fx.rain.geometry.drawRange.count;
    fx.set({ rain: 1, fog: 0, kind: 'storm' });
    fx.frame(0.016, camera);
    expect(fx.rain.visible).toBe(true);
    expect(fx.rain.geometry.drawRange.count).toBeGreaterThan(half);
    expect(fx.rain.geometry.drawRange.count).toBe(cfg.rainDrops * 2);
    expect(fx.rain.position.toArray()).toEqual([10, 2, -5]);
  });

  it('draws no streaks when the setting is zero, though fog still works', () => {
    const scene = new Scene();
    const fx = new WeatherFx(scene, addLighting(scene), { ...cfg, rainDrops: 0 });
    fx.set({ rain: 1, fog: 0.6, kind: 'storm' });
    fx.frame(0.016, new PerspectiveCamera());
    expect(fx.rain.visible).toBe(false);
  });
});

describe('pinnedWeather', () => {
  const real = { rain: 0.2, fog: 0.1, kind: 'rain' as const };
  it('uses the real weather unless the address names a kind', () => {
    expect(pinnedWeather(null, real)).toBe(real);
    expect(pinnedWeather('nonsense', real)).toBe(real);
    expect(pinnedWeather('storm', real).rain).toBe(1);
  });
});
