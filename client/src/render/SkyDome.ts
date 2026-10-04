import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3, type Camera } from 'three';
import type { SkyState } from './dayNight';

/** Inside the camera's far plane (220 m), outside everything the fog leaves visible. */
const RADIUS = 200;

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform float uNight;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 dir = normalize(vDir);
  float up = clamp(dir.y, 0.0, 1.0);
  vec3 color = mix(uHorizon, uZenith, pow(up, 0.55));
  // Below the horizon (seen past rooftops at the city edge) fade to a darker horizon.
  color = mix(color, uHorizon * 0.6, clamp(-dir.y * 4.0, 0.0, 1.0));
  // Sun: a hard disc and a soft halo, fading out as night falls.
  float s = dot(dir, uSunDir);
  float day = 1.0 - uNight;
  color += vec3(1.0, 0.92, 0.75) * smoothstep(0.9993, 0.9997, s) * day * 3.0;
  color += vec3(1.0, 0.8, 0.55) * pow(max(s, 0.0), 48.0) * 0.35 * day;
  // Moon opposite the sun, and stars, at night.
  float m = dot(dir, -uSunDir);
  color += vec3(0.75, 0.8, 0.95) * smoothstep(0.9995, 0.9998, m) * uNight;
  vec3 cell = floor(dir * 220.0);
  float star = step(0.9975, hash(cell)) * up;
  color += vec3(star) * uNight * 0.9;
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * A gradient sky around the camera: horizon to zenith colours, a sun disc by
 * day, the moon and stars by night. One draw call, unaffected by fog.
 */
export class SkyDome {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      name: 'sky',
      uniforms: {
        uZenith: { value: new Color() },
        uHorizon: { value: new Color() },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uNight: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(RADIUS, 32, 16), this.material);
    this.mesh.name = 'sky-dome';
    this.mesh.frustumCulled = false;
    // Drawn first, behind everything.
    this.mesh.renderOrder = -1;
  }

  apply(state: SkyState): void {
    const u = this.material.uniforms;
    (u.uZenith?.value as Color).copy(state.zenith);
    (u.uHorizon?.value as Color).copy(state.horizon);
    (u.uSunDir?.value as Vector3).copy(state.sunDirection);
    if (u.uNight) u.uNight.value = state.night;
  }

  /** Keeps the sky centred on the camera, so it is always at the same apparent distance. */
  follow(camera: Camera): void {
    this.mesh.position.copy(camera.position);
  }

  uniform(name: string): unknown {
    return this.material.uniforms[name]?.value;
  }
}
