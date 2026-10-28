/**
 * Fires when every key of a chord is held at once (Phase 37: the cheat prompt). Fed key events, it
 * knows nothing of the DOM. Releasing any key, or the window losing focus, forgets what was held, so
 * a chord is always a fresh press of the whole set; holding it does not fire again until a key is let go.
 */
export class ChordWatcher {
  private readonly held = new Set<string>();
  private fired = false;

  constructor(
    private combo: readonly string[],
    private readonly onChord: () => void,
  ) {}

  setCombo(combo: readonly string[]): void {
    this.combo = combo;
    this.fired = false;
  }

  /** Returns true when this key press completed the chord (the caller may stop the event). */
  down(code: string): boolean {
    this.held.add(code);
    if (this.fired || this.combo.length === 0 || !this.combo.every((k) => this.held.has(k)))
      return false;
    this.fired = true;
    this.onChord();
    return true;
  }

  up(code: string): void {
    this.held.delete(code);
    if (this.combo.includes(code)) this.fired = false;
  }

  /** The window lost focus: nothing is held any more. */
  reset(): void {
    this.held.clear();
    this.fired = false;
  }

  /** Listens on a window (capture phase, so the editor cannot swallow the chord); returns a stop function. */
  attach(target: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void {
    const down = (e: KeyboardEvent) => {
      if (this.down(e.code)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => this.up(e.code);
    const blur = () => this.reset();
    target.addEventListener('keydown', down as EventListener, true);
    target.addEventListener('keyup', up as EventListener, true);
    target.addEventListener('blur', blur);
    return () => {
      target.removeEventListener('keydown', down as EventListener, true);
      target.removeEventListener('keyup', up as EventListener, true);
      target.removeEventListener('blur', blur);
    };
  }
}
