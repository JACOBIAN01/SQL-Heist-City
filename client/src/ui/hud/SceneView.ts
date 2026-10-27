import type { SceneMessage } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import { clear, h } from '../dom';
import './hud.css';

/**
 * Story scenes (Phase 32.3): a few lines said in turn over the game, which keeps running. A click,
 * Space or Enter shows the next line; Skip (or Escape) ends it. Scenes are text only.
 */
export class SceneView {
  readonly root = h('section', {
    class: 'scene',
    attrs: { 'data-role': 'scene', role: 'dialog', hidden: '' },
  });
  private queue: SceneMessage[] = [];
  private scene: SceneMessage | undefined;
  private line = 0;

  constructor(
    private readonly i18n: I18n,
    /** Called when a scene starts (the pointer is released) and when it ends. */
    private readonly hooks: { onStart?: () => void; onEnd?: () => void } = {},
  ) {
    i18n.onChange(() => this.draw());
  }

  get playing(): boolean {
    return this.scene !== undefined;
  }

  /** Plays a scene now, or after the one that is playing. */
  play(scene: SceneMessage): void {
    if (this.scene) {
      this.queue.push(scene);
      return;
    }
    this.begin(scene);
  }

  /** The next line, or the end of the scene. */
  advance(): void {
    if (!this.scene) return;
    this.line++;
    if (this.line >= this.scene.lines.length) this.skip();
    else this.draw();
  }

  /** Ends the scene at once and starts the next one waiting, if any. */
  skip(): void {
    if (!this.scene) return;
    this.scene = undefined;
    const next = this.queue.shift();
    if (next) this.begin(next);
    else {
      this.root.hidden = true;
      clear(this.root);
      this.hooks.onEnd?.();
    }
  }

  private begin(scene: SceneMessage): void {
    const first = this.scene === undefined && this.queue.length === 0 && this.root.hidden;
    this.scene = scene;
    this.line = 0;
    this.root.hidden = false;
    if (first) this.hooks.onStart?.();
    this.draw();
  }

  private draw(): void {
    clear(this.root);
    const scene = this.scene;
    if (!scene) return;
    const line = scene.lines[this.line];
    if (!line) return;
    this.root.setAttribute('aria-label', scene.title);
    this.root.append(
      h('h2', { class: 'scene-title', text: scene.title }),
      h('p', { class: 'scene-line' }, h('b', { text: `${line.speaker}: ` }), line.text),
      h(
        'div',
        { class: 'scene-actions' },
        h('button', {
          text: this.i18n.t('scene.next'),
          attrs: { 'data-action': 'next' },
          on: { click: () => this.advance() },
        }),
        h('button', {
          text: this.i18n.t('scene.skip'),
          attrs: { 'data-action': 'skip' },
          on: { click: () => this.skip() },
        }),
      ),
    );
  }
}

/** A fixer's short line shown at the bottom of the screen for a few seconds (Phase 32.3). */
export class BarkView {
  readonly root = h('div', {
    class: 'bark',
    attrs: { 'data-role': 'bark', role: 'status', hidden: '' },
  });
  private hideAt = 0;

  show(speaker: string, text: string, now: number): void {
    this.root.textContent = `${speaker}: ${text}`;
    this.root.hidden = false;
    this.hideAt = now + 6000;
  }

  frame(now: number): void {
    if (!this.root.hidden && now >= this.hideAt) this.root.hidden = true;
  }
}
