import { Color, DirectionalLight, Fog, HemisphereLight, type Object3D, type Scene } from 'three';

const SHADOW_RADIUS = 45;
const SUN_OFFSET = { x: 30, y: 50, z: 20 } as const;

export interface Lighting {
  readonly sun: DirectionalLight;
  /** Re-centres the shadow volume so shadows stay sharp near the player only. */
  follow(target: Object3D): void;
}

/**
 * One dynamic sun with shadows near the player, sky/ground fill light and fog
 * for depth (frontend.md rendering approach). Gradient sky and day/night come
 * in Phase 8; the day colour is a single constant until then.
 */
export function addLighting(scene: Scene): Lighting {
  const sky = new Color(0x9fb8d6);
  scene.background = sky;
  scene.fog = new Fog(sky, 60, 170);

  scene.add(new HemisphereLight(0xcfe0ff, 0x4a4036, 0.85));

  const sun = new DirectionalLight(0xfff1d6, 2.2);
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

  return {
    sun,
    follow(target) {
      sun.target.position.copy(target.position);
      sun.position.set(
        target.position.x + SUN_OFFSET.x,
        target.position.y + SUN_OFFSET.y,
        target.position.z + SUN_OFFSET.z,
      );
    },
  };
}
