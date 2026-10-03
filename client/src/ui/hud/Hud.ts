import { h } from '../dom';
import './hud.css';

/** What game logic may ask of the HUD. Kept as an interface so logic is tested without a DOM. */
export interface HudView {
  setHealth(hp: number, max: number): void;
  setProtected(isProtected: boolean): void;
  flashDamage(): void;
  showHitMarker(head: boolean): void;
  addKill(killer: string, victim: string, involvesYou: boolean): void;
  setDead(dead: boolean, secondsLeft?: number): void;
}

const MAX_FEED = 5;
const FEED_MS = 5000;

/** Plain-DOM HUD (no framework: bundle budget). Text always goes in as text nodes, never HTML. */
export class Hud implements HudView {
  readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly shield: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly dead: HTMLElement;
  private readonly deadSub: HTMLElement;
  private markerTimer: ReturnType<typeof setTimeout> | undefined;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: HTMLElement) {
    this.fill = h('div', { class: 'hud-health-fill' });
    this.hpText = h('span');
    this.shield = h('div', { class: 'hud-shield', text: 'Spawn protection' });
    this.shield.hidden = true;
    this.marker = h('div', { class: 'hud-hitmarker' });
    this.flash = h('div', { class: 'hud-flash' });
    this.feed = h('div', { class: 'hud-feed', attrs: { 'aria-live': 'polite' } });
    this.deadSub = h('div');
    this.dead = h('div', { class: 'hud-dead' }, h('h1', { text: 'YOU DIED' }), this.deadSub);
    this.dead.hidden = true;

    this.root = h(
      'div',
      { class: 'hud' },
      this.flash,
      h('div', { class: 'hud-crosshair' }),
      this.marker,
      this.feed,
      h(
        'div',
        { class: 'hud-health' },
        h('div', { class: 'hud-health-label' }, h('span', { text: 'HEALTH' }), this.hpText),
        h('div', { class: 'hud-health-bar' }, this.fill),
        this.shield,
      ),
      this.dead,
    );
    host.append(this.root);
  }

  setHealth(hp: number, max: number): void {
    const fraction = Math.max(0, Math.min(1, hp / max));
    this.fill.style.width = `${fraction * 100}%`;
    this.fill.dataset.low = String(fraction <= 0.3);
    this.hpText.textContent = String(Math.max(0, Math.round(hp)));
  }

  setProtected(isProtected: boolean): void {
    this.shield.hidden = !isProtected;
  }

  flashDamage(): void {
    this.flash.classList.add('show');
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.classList.remove('show'), 60);
  }

  showHitMarker(head: boolean): void {
    this.marker.dataset.head = String(head);
    this.marker.classList.add('show');
    clearTimeout(this.markerTimer);
    this.markerTimer = setTimeout(() => this.marker.classList.remove('show'), 150);
  }

  addKill(killer: string, victim: string, involvesYou: boolean): void {
    const item = h(
      'div',
      { class: 'hud-feed-item' },
      involvesYou ? h('b', { text: killer }) : killer,
      ' ✖ ',
      involvesYou ? h('b', { text: victim }) : victim,
    );
    this.feed.append(item);
    while (this.feed.children.length > MAX_FEED) this.feed.firstElementChild?.remove();
    setTimeout(() => item.remove(), FEED_MS);
  }

  setDead(dead: boolean, secondsLeft?: number): void {
    this.dead.hidden = !dead;
    this.deadSub.textContent =
      dead && secondsLeft !== undefined
        ? `Respawning in ${Math.max(0, Math.ceil(secondsLeft))}…`
        : '';
  }

  destroy(): void {
    clearTimeout(this.markerTimer);
    clearTimeout(this.flashTimer);
    this.root.remove();
  }
}
