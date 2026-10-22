import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AtmosphereSettings } from '@heist/shared';
import type { CrowdModel } from './CrowdModel';

/** Kerb height: people walk on the sidewalk, 0.15 m above the asphalt. */
const KERB = 0.15;

/** A person as three boxes (legs, torso, head), about 1.7 m tall. One geometry for the whole crowd. */
function personGeometry(): BufferGeometry {
  const part = (w: number, h: number, d: number, y: number) =>
    new BoxGeometry(w, h, d).translate(0, y, 0);
  return mergeGeometries(
    [part(0.3, 0.8, 0.2, 0.4), part(0.46, 0.65, 0.26, 1.12), part(0.22, 0.24, 0.22, 1.58)],
    false,
  ) as BufferGeometry;
}

/** The same person as one plain box, for those too far away to show any detail. */
const farGeometry = (): BufferGeometry => new BoxGeometry(0.46, 1.7, 0.26).translate(0, 0.85, 0);

/**
 * Draws the crowd with two instanced meshes: people with a body shape near the viewer, a plain
 * box beyond (Phase 29.1). Two draw calls however many people there are; only those within the
 * draw radius are placed each frame.
 */
export class CrowdRenderer {
  private readonly near: InstancedMesh;
  private readonly far: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly colour = new Color();
  private time = 0;
  /** What was drawn last frame (for tests and the debug overlay). */
  drawn = { near: 0, far: 0 };

  constructor(
    scene: Scene,
    private readonly model: CrowdModel,
    private readonly settings: () => AtmosphereSettings['crowd'],
    capacity = 500,
  ) {
    const make = (geometry: BufferGeometry) => {
      const mesh = new InstancedMesh(geometry, new MeshLambertMaterial(), capacity);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false; // instances move all over the city
      mesh.count = 0;
      scene.add(mesh);
      return mesh;
    };
    this.near = make(personGeometry());
    this.far = make(farGeometry());
  }

  /** Moves the crowd on and places everyone in range. Call once a frame. */
  update(viewer: { x: number; z: number }, dtSeconds: number): void {
    const { drawRadius, detailRadius } = this.settings();
    this.model.update(dtSeconds);
    this.time += dtSeconds;
    let near = 0;
    let far = 0;
    for (const p of this.model.near(viewer, drawRadius)) {
      const close = Math.hypot(p.x - viewer.x, p.z - viewer.z) <= detailRadius;
      const mesh = close ? this.near : this.far;
      const slot = close ? near : far;
      if (slot >= mesh.instanceMatrix.count) continue;
      // Steps bounce a little; running people bounce faster and lean into it.
      const bob =
        close && p.moving
          ? Math.abs(Math.sin(this.time * (p.fleeing ? 11 : 6) + p.phase)) * 0.05
          : 0;
      this.dummy.position.set(p.x, KERB + bob, p.z);
      this.dummy.rotation.set(p.fleeing ? 0.18 : 0, p.heading, 0);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(slot, this.dummy.matrix);
      mesh.setColorAt(slot, this.colour.setHex(p.tint));
      if (close) near++;
      else far++;
    }
    for (const [mesh, n] of [
      [this.near, near],
      [this.far, far],
    ] as const) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.drawn = { near, far };
  }

  dispose(): void {
    for (const mesh of [this.near, this.far]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as MeshLambertMaterial).dispose();
    }
  }
}
