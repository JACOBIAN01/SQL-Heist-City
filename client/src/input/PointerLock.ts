import type { InputSampler } from './InputSampler';

/**
 * Click the game to capture the mouse (needed for mouse look); Esc gives it
 * back. The sampler is told whether we are locked so look/fire only work then.
 * Calls `onChange` so the HUD can show or hide the "click to play" hint.
 */
export class PointerLock {
  constructor(
    private readonly element: HTMLElement,
    private readonly input: InputSampler,
    private readonly onChange: (locked: boolean) => void = () => {},
  ) {
    element.addEventListener('click', this.onClick);
    element.addEventListener('mousedown', this.onMouse);
    window.addEventListener('mouseup', this.onMouse);
    // Right mouse aims: never open the browser's menu over the game.
    element.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  /** Hands the mouse back, e.g. when the SQL panel opens. */
  release(): void {
    if (this.locked) document.exitPointerLock();
  }

  destroy(): void {
    this.element.removeEventListener('click', this.onClick);
    this.element.removeEventListener('mousedown', this.onMouse);
    window.removeEventListener('mouseup', this.onMouse);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }

  private readonly onClick = (): void => {
    if (!this.locked) void this.element.requestPointerLock?.();
  };

  private readonly onMouse = (event: MouseEvent): void => {
    this.input.pressMouse(event.button, event.type === 'mousedown');
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onLockChange = (): void => {
    this.input.setLooking(this.locked);
    this.onChange(this.locked);
  };
}
