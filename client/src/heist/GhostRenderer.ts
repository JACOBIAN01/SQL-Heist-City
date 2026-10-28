import { CapsuleGeometry, Mesh, MeshBasicMaterial, type Object3D, type Scene } from 'three';
import { ghostAt, type GhostMessage } from '@heist/shared';

const BODY = new CapsuleGeometry(0.3, 1.0, 4, 10);
const GLASS = new MeshBasicMaterial({
  color: 0xcfe8ff,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
});

/** How long (s) a ghost lingers at the end of its run before it fades away. */
const LINGER_SECONDS = 6;

/**
 * A ghost to race (Phase 34.6): a translucent figure that replays the best heist on a bank from the
 * moment you began yours. The server sends the trace; this only moves a shape along it.
 */
export class GhostRenderer {
  readonly object: Object3D;
  private ghost: { message: GhostMessage; startedAt: number } | undefined;

  constructor(private readonly scene: Scene) {
    const mesh = new Mesh(BODY, GLASS);
    mesh.name = 'ghost';
    mesh.visible = false;
    this.object = mesh;
    scene.add(mesh);
  }

  /** A ghost arrived: it starts running now. */
  start(message: GhostMessage, now: number): void {
    this.ghost = { message, startedAt: now };
  }

  /** The race is over (or the round ended): the ghost goes. */
  stop(): void {
    this.ghost = undefined;
    this.object.visible = false;
  }

  /** Where the ghost is now, for the minimap; undefined when there is none. */
  position(now: number): { x: number; z: number } | undefined {
    const g = this.ghost;
    if (!g) return undefined;
    const at = ghostAt(g.message.trace, (now - g.startedAt) / 1000);
    return at && { x: at.x, z: at.z };
  }

  /** Call every frame. */
  update(now: number): void {
    const g = this.ghost;
    if (!g) return;
    const t = (now - g.startedAt) / 1000;
    if (t > g.message.seconds + LINGER_SECONDS) return this.stop();
    const at = ghostAt(g.message.trace, t);
    if (!at) return this.stop();
    this.object.visible = true;
    // The figure's feet are on the floor: the capsule's middle is a metre up.
    this.object.position.set(at.x, at.y + 0.9, at.z);
  }

  dispose(): void {
    this.scene.remove(this.object);
  }
}
