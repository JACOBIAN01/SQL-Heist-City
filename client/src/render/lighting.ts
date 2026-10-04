import {
  DirectionalLight,
  Fog,
  HemisphereLight,
  Vector3,
  type Camera,
  type Object3D,
  type Scene,
} from 'three';
import { skyAt, type SkyState } from './dayNight';
import { SkyDome } from './SkyDome';

const SHADOW_RADIUS = 45;
/** How far from the shadow centre the light sits, along its direction. */
const LIGHT_DISTANCE = 60;
/** The hour a scene shows until something sets it. */
const DEFAULT_HOUR = 11;

export interface Lighting {
  readonly sun: DirectionalLight;
  readonly sky: SkyDome;
  /** The state last applied (for HUD clocks and tests). */
  readonly state: SkyState;
  /** Re-centres the shadow volume so shadows stay sharp near the player only. */
  follow(target: Object3D): void;
  /** Sets light, fog and sky for a time of day. */
  apply(state: SkyState): void;
  /** Keeps the sky dome around the camera; call every frame. */
  frame(camera: Camera): void;
}

/**
 * One dynamic light with shadows near the player (the sun by day, the moon
 * by night), sky/ground fill light, fog matched to the horizon and a sky dome
 * (frontend.md rendering approach).
 */
export function addLighting(scene: Scene): Lighting {
  scene.fog = new Fog(0xffffff, 60, 170);
  const fill = new HemisphereLight(0xffffff, 0x000000, 1);
  scene.add(fill);

  const sun = new DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -SHADOW_RADIUS;
  cam.right = SHADOW_RADIUS;
  cam.top = SHADOW_RADIUS;
  cam.bottom = -SHADOW_RADIUS;
  cam.near = 1;
  cam.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const sky = new SkyDome();
  scene.add(sky.mesh);
  const toLight = new Vector3();
  let state = skyAt(DEFAULT_HOUR);

  const lighting: Lighting = {
    sun,
    sky,
    get state() {
      return state;
    },
    follow(target) {
      sun.target.position.copy(target.position);
      toLight.copy(state.lightDirection).multiplyScalar(LIGHT_DISTANCE);
      sun.position.copy(target.position).add(toLight);
    },
    apply(next) {
      state = next;
      sun.color.copy(next.lightColor);
      sun.intensity = next.lightIntensity;
      fill.color.copy(next.skyColor);
      fill.groundColor.copy(next.groundColor);
      fill.intensity = next.ambientIntensity;
      // Fog fades into the horizon, so far buildings melt into the sky at any hour.
      const fog = scene.fog as Fog;
      fog.color.copy(next.horizon);
      fog.near = next.fogNear;
      fog.far = next.fogFar;
      sky.apply(next);
    },
    frame(camera) {
      sky.follow(camera);
    },
  };
  lighting.apply(state);
  return lighting;
}
