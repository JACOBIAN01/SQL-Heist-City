import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, type Scene } from 'three';

interface Slot {
  readonly line: Line;
  readonly positions: Float32BufferAttribute;
  readonly material: LineBasicMaterial;
  age: number;
  active: boolean;
}

/**
 * Bullet trails. Pattern: Object Pool — Why: shots are frequent (a shotgun
 * fires 8 per trigger pull); reusing a fixed set of line objects means no
 * allocation or GC pressure mid-fight.
 */
export class Tracers {
  private readonly slots: Slot[] = [];
  private next = 0;

  constructor(
    scene: Scene,
    size = 48,
    private readonly lifetimeSeconds = 0.12,
  ) {
    for (let i = 0; i < size; i++) {
      const positions = new Float32BufferAttribute(new Float32Array(6), 3);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', positions);
      const material = new LineBasicMaterial({ color: 0xffe9a8, transparent: true });
      const line = new Line(geometry, material);
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.slots.push({ line, positions, material, age: 0, active: false });
    }
  }

  get activeCount(): number {
    return this.slots.filter((s) => s.active).length;
  }

  add(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): void {
    // Reuse the oldest slot when every one is busy.
    const slot = this.slots[this.next] as Slot;
    this.next = (this.next + 1) % this.slots.length;
    slot.positions.setXYZ(0, from.x, from.y, from.z);
    slot.positions.setXYZ(1, to.x, to.y, to.z);
    slot.positions.needsUpdate = true;
    slot.age = 0;
    slot.active = true;
    slot.line.visible = true;
    slot.material.opacity = 1;
  }

  update(dtSeconds: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dtSeconds;
      if (slot.age >= this.lifetimeSeconds) {
        slot.active = false;
        slot.line.visible = false;
      } else {
        slot.material.opacity = 1 - slot.age / this.lifetimeSeconds;
      }
    }
  }
}
