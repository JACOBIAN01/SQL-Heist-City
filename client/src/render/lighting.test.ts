import { describe, expect, it } from 'vitest';
import type { Fog } from 'three';
import { HemisphereLight, Object3D, PerspectiveCamera, Scene } from 'three';
import { skyAt } from './dayNight';
import { addLighting } from './lighting';

describe('addLighting', () => {
  it('applies a time of day to the light, the fill, the fog and the sky', () => {
    const scene = new Scene();
    const lighting = addLighting(scene);
    const night = skyAt(23);
    lighting.apply(night);
    expect(lighting.state).toBe(night);
    expect(lighting.sun.intensity).toBe(night.lightIntensity);
    const fog = scene.fog as Fog;
    expect(fog.color.equals(night.horizon)).toBe(true);
    expect(fog.far).toBe(night.fogFar);
    const fill = scene.children.find((c) => c instanceof HemisphereLight) as HemisphereLight;
    expect(fill.intensity).toBe(night.ambientIntensity);
    expect(lighting.sky.uniform('uNight')).toBe(1);
  });

  it('puts the shadow light up along the light direction from the player', () => {
    const lighting = addLighting(new Scene());
    lighting.apply(skyAt(9));
    const player = new Object3D();
    player.position.set(10, 0, -5);
    lighting.follow(player);
    const offset = lighting.sun.position.clone().sub(player.position).normalize();
    expect(offset.dot(lighting.state.lightDirection)).toBeCloseTo(1);
    expect(lighting.sun.target.position.equals(player.position)).toBe(true);
  });

  it('keeps the sky dome centred on the camera', () => {
    const lighting = addLighting(new Scene());
    const camera = new PerspectiveCamera();
    camera.position.set(40, 2, 7);
    lighting.frame(camera);
    expect(lighting.sky.mesh.position.equals(camera.position)).toBe(true);
    expect(lighting.sky.mesh.frustumCulled).toBe(false);
  });
});
