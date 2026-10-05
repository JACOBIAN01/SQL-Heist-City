/** How quickly the view zooms in and out (1/s): about a fifth of a second to settle. */
const ZOOM_RATE = 14;
/** At this zoom or more the view is a scope: the overlay shows and the gun is not drawn in front. */
export const SCOPE_ZOOM = 3;

/**
 * Aiming down the sights, as the shooter sees it: the field of view eases
 * toward the gun's zoom while aim is held, and mouse look slows by the same
 * factor so a scoped crosshair stays steady.
 */
export class AimView {
  private zoom = 1;

  constructor(private readonly baseFov: number) {}

  /** Eases toward `target` zoom (1 when not aiming); returns the field of view to use. */
  update(target: number, dtSeconds: number): number {
    this.zoom += (target - this.zoom) * (1 - Math.exp(-ZOOM_RATE * dtSeconds));
    if (Math.abs(target - this.zoom) < 1e-3) this.zoom = target;
    return this.fov;
  }

  get fov(): number {
    return this.baseFov / this.zoom;
  }

  /** Mouse-look multiplier: slower the further in the view is zoomed. */
  get lookScale(): number {
    return 1 / this.zoom;
  }

  get scoped(): boolean {
    return this.zoom >= SCOPE_ZOOM - 0.25;
  }
}
