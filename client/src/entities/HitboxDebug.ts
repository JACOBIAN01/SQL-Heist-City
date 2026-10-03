import {
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Scene,
} from 'three';
import { Flag, type CombatSettings, type MovementSettings } from '@heist/shared';

interface PoseLike {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly flags: number;
  readonly hp: number;
}

/**
 * `?debug`: draws the server's hit-box (an upright cylinder; the top slice is the
 * head) around every other player, tinted by health, so you can see what a
 * bullet actually has to touch. Sizes come from the same shared settings the
 * server shoots against.
 */
export class HitboxDebug {
  private readonly boxes = new Map<number, Group>();
  private readonly edges: EdgesGeometry;
  private readonly body = new LineBasicMaterial({ color: 0x4cc38a });
  private readonly head = new LineBasicMaterial({ color: 0xef6b5f });

  constructor(
    private readonly scene: Scene,
    private readonly combat: Pick<CombatSettings, 'bodyRadius' | 'headHeight'>,
    private readonly movement: Pick<MovementSettings, 'standHeight' | 'crouchHeight'>,
  ) {
    this.edges = new EdgesGeometry(new CylinderGeometry(1, 1, 1, 16, 1, false));
  }

  get count(): number {
    return this.boxes.size;
  }

  update(poses: Iterable<PoseLike>): void {
    const seen = new Set<number>();
    for (const pose of poses) {
      seen.add(pose.id);
      let group = this.boxes.get(pose.id);
      if (!group) {
        group = new Group();
        group.add(new LineSegments(this.edges, this.body), new LineSegments(this.edges, this.head));
        this.scene.add(group);
        this.boxes.set(pose.id, group);
      }
      const height =
        (pose.flags & Flag.Crouching) !== 0
          ? this.movement.crouchHeight
          : this.movement.standHeight;
      const r = this.combat.bodyRadius;
      const headH = this.combat.headHeight;
      const [bodyLines, headLines] = group.children as [LineSegments, LineSegments];
      // Body part below the head slice, then the head slice itself (red).
      bodyLines.scale.set(r, height - headH, r);
      bodyLines.position.set(0, (height - headH) / 2, 0);
      headLines.scale.set(r, headH, r);
      headLines.position.set(0, height - headH / 2, 0);
      group.position.set(pose.x, pose.y, pose.z);
      group.visible = (pose.flags & Flag.Alive) !== 0;
    }
    for (const [id, group] of this.boxes) {
      if (seen.has(id)) continue;
      this.scene.remove(group);
      this.boxes.delete(id);
    }
  }
}
