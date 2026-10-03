import { h } from '../dom';
import { rewardIcon } from '../icons/icons';
import { createResizer } from './Resizer';

export type PanelState = 'closed' | 'open' | 'minimised';
export type PanelListener = (state: PanelState, previous: PanelState) => void;

/** Elements other modules fill in. The shell owns layout and open/minimise only. */
export interface PanelSlots {
  readonly tier: HTMLElement;
  readonly title: HTMLElement;
  readonly timer: HTMLElement;
  readonly switcher: HTMLElement;
  readonly problem: HTMLElement;
  readonly work: HTMLElement;
}

/**
 * The SQL challenge panel frame: a translucent side panel over the world, plus
 * a slim bar when minimised. It never pauses or blocks the game — only the
 * panel itself captures pointer events (see sqlPanel.css).
 */
export class SqlPanel {
  readonly slots: PanelSlots;
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly tile: HTMLElement;
  private readonly listeners = new Set<PanelListener>();
  private current: PanelState = 'closed';

  constructor(private readonly host: HTMLElement) {
    const tile = h('span', { class: 'sqlp-tile', attrs: { hidden: '' } });
    const tier = h('span', { class: 'sqlp-tier' });
    const title = h('span', { class: 'sqlp-title' });
    const timer = h('span', { class: 'sqlp-timer', attrs: { 'aria-live': 'off' } });
    const switcher = h('span', { class: 'sqlp-switcher' });
    const problem = h('section', { class: 'sqlp-problem', attrs: { 'aria-label': 'Task' } });
    const work = h('section', { class: 'sqlp-work', attrs: { 'aria-label': 'Your query' } });

    const body: HTMLElement = h(
      'div',
      { class: 'sqlp-body' },
      problem,
      createResizer({
        axis: 'x',
        direction: 1,
        label: 'Task and editor split',
        read: () => problem.getBoundingClientRect().width,
        apply: (px) => body.style.setProperty('--sqlp-split', `${px}px`),
        min: () => 140,
        max: () => Math.max(140, body.getBoundingClientRect().width - 200),
        reset: () => body.style.removeProperty('--sqlp-split'),
        storageKey: 'sqlp.split',
      }),
      work,
    );

    this.root = h(
      'aside',
      {
        class: 'sqlp',
        attrs: { role: 'dialog', 'aria-label': 'SQL challenge', 'data-state': 'closed' },
      },
      h(
        'header',
        { class: 'sqlp-head' },
        h('div', { class: 'sqlp-heading' }, tile, tier, title),
        timer,
        h(
          'div',
          { class: 'sqlp-actions' },
          switcher,
          h('button', {
            class: 'sqlp-btn',
            text: '—',
            attrs: { type: 'button', 'aria-label': 'Minimise', title: 'Minimise (keep playing)' },
            on: { click: () => this.minimise() },
          }),
          h('button', {
            class: 'sqlp-btn',
            text: '✕',
            attrs: { type: 'button', 'aria-label': 'Close', title: 'Close and drop this task' },
            on: { click: () => this.close() },
          }),
        ),
      ),
      body,
    );
    this.root.prepend(
      createResizer({
        axis: 'x',
        direction: -1,
        label: 'Panel width',
        read: () => this.root.getBoundingClientRect().width,
        apply: (px) => this.root.style.setProperty('--sqlp-width', `${px}px`),
        min: () => 360,
        max: () => window.innerWidth * 0.95,
        reset: () => this.root.style.removeProperty('--sqlp-width'),
        storageKey: 'sqlp.width',
      }),
    );

    this.bar = h(
      'div',
      { class: 'sqlp-bar', attrs: { 'data-state': 'closed' } },
      h('span', { class: 'sqlp-tile small', attrs: { 'data-role': 'bar-icon', hidden: '' } }),
      h('span', { class: 'sqlp-bar-title', attrs: { 'data-role': 'bar-title' } }),
      h('span', { class: 'sqlp-bar-timer', attrs: { 'data-role': 'bar-timer' } }),
      h('button', {
        class: 'sqlp-btn',
        text: 'Resume',
        attrs: { type: 'button' },
        on: { click: () => this.restore() },
      }),
    );

    this.tile = tile;
    this.slots = { tier, title, timer, switcher, problem, work };
    // Esc anywhere in the panel except inside the editor (where it just leaves
    // the editor) hands the keyboard back to the game by minimising.
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if ((event.target as HTMLElement).closest('.cm-editor')) return;
      this.minimise();
    });
    this.host.append(this.root, this.bar);
    this.render();
  }

  get state(): PanelState {
    return this.current;
  }

  /** Short text shown on the minimised bar (task name, remaining time). */
  setBarText(title: string, timer: string): void {
    const set = (role: string, text: string) => {
      const el = this.bar.querySelector(`[data-role="${role}"]`);
      if (el) el.textContent = text;
    };
    set('bar-title', title);
    set('bar-timer', timer);
  }

  /** Shows the task's icon (tier-coloured tile) in the header and on the minimised bar. */
  setTaskIcon(rewardKey: string, tier: number): void {
    const barTile = this.bar.querySelector<HTMLElement>('[data-role="bar-icon"]');
    for (const tile of [this.tile, barTile]) {
      if (!tile) continue;
      tile.dataset.tier = String(tier);
      tile.replaceChildren(rewardIcon(rewardKey));
      tile.hidden = false;
    }
  }

  open(): void {
    this.transition('open');
  }

  minimise(): void {
    if (this.current !== 'open') return;
    // Give keyboard focus back to the page so movement keys reach the game.
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.transition('minimised');
  }

  restore(): void {
    if (this.current === 'minimised') this.transition('open');
  }

  close(): void {
    this.transition('closed');
  }

  /** Observer: lets the game react (auto-crouch, HUD) without the panel knowing about it. */
  onStateChange(listener: PanelListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.root.remove();
    this.bar.remove();
    this.listeners.clear();
  }

  private transition(next: PanelState): void {
    if (next === this.current) return;
    const previous = this.current;
    this.current = next;
    this.render();
    for (const listener of this.listeners) listener(next, previous);
  }

  private render(): void {
    this.root.dataset.state = this.current;
    this.bar.dataset.state = this.current;
    this.root.hidden = this.current !== 'open';
    this.bar.hidden = this.current !== 'minimised';
  }
}
