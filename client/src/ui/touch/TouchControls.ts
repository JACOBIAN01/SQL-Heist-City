import type { Action, PlayerSettings } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { h } from '../dom';
import './touch.css';
import { shapeStick, type PadActions, type PadTarget } from '../../input/GamepadAdapter';

/** Radians of turn per pixel dragged, before the player's look speed. */
const DRAG_TURN = 0.006;
/** How far (px) the thumb moves the stick to full. */
const STICK_RADIUS = 56;

interface ButtonSpec {
  readonly action: Action;
  readonly glyph: string;
  /** Held while touched, or done once per touch. */
  readonly mode: 'hold' | 'tap';
}
const BUTTONS: readonly ButtonSpec[] = [
  { action: 'fire', glyph: '✹', mode: 'hold' },
  { action: 'aim', glyph: '◎', mode: 'hold' },
  { action: 'jump', glyph: '⤒', mode: 'hold' },
  { action: 'crouch', glyph: '⤓', mode: 'hold' },
  { action: 'sprint', glyph: '»', mode: 'hold' },
  { action: 'use', glyph: '✋', mode: 'tap' },
  { action: 'tasks', glyph: '☰', mode: 'tap' },
  { action: 'settings', glyph: '⚙', mode: 'tap' },
];

/** Does this device want on-screen controls? `auto` means it reports a touch screen as its main input. */
export function wantsTouchControls(
  mode: PlayerSettings['touch']['controls'],
  coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
): boolean {
  return mode === 'on' || (mode === 'auto' && coarse);
}

/**
 * On-screen controls for tablets and touch Chromebooks (Phase 22.5): a stick on one side, a drag
 * area that turns the view, and buttons for the actions. Like the gamepad, it only makes the same
 * calls the keyboard ends up making. The layout can be mirrored for left-handed players.
 *
 * Pattern: Adapter — Why: touches are pointer events; the game wants a stick and actions.
 */
export class TouchControls {
  readonly root = h('div', { class: 'touch', attrs: { 'data-role': 'touch', hidden: '' } });
  private stickId: number | undefined;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | undefined;
  private lookLast = { x: 0, y: 0 };
  private knob: HTMLElement | undefined;

  constructor(
    parent: HTMLElement,
    private readonly target: PadTarget,
    private readonly actions: PadActions,
    private readonly settings: () => PlayerSettings,
    private readonly i18n: I18n,
  ) {
    parent.appendChild(this.root);
    i18n.onChange(() => this.build());
    this.build();
  }

  /** Shows or hides the controls to match the settings (call when they change). */
  refresh(coarse?: boolean): void {
    const s = this.settings();
    const on = wantsTouchControls(s.touch.controls, coarse);
    this.root.hidden = !on;
    this.root.classList.toggle('touch-left-handed', s.touch.leftHanded);
    if (!on) this.releaseAll();
  }

  private t(key: MessageKey): string {
    return this.i18n.t(key);
  }

  private build(): void {
    this.releaseAll();
    this.root.replaceChildren();
    const stick = h('div', { class: 'touch-stick', attrs: { 'data-role': 'touch-stick' } });
    this.knob = h('div', { class: 'touch-knob' });
    stick.appendChild(this.knob);
    this.bindStick(stick);
    const look = h('div', { class: 'touch-look', attrs: { 'data-role': 'touch-look' } });
    this.bindLook(look);
    const pad = h('div', { class: 'touch-buttons' });
    for (const spec of BUTTONS) pad.appendChild(this.button(spec));
    this.root.append(look, stick, pad);
  }

  private button(spec: ButtonSpec): HTMLElement {
    const el = h('button', {
      class: `touch-button touch-${spec.action}`,
      text: spec.glyph,
      attrs: { 'aria-label': this.t(`action.${spec.action}` as MessageKey), type: 'button' },
    });
    const down = (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      if (spec.mode === 'hold') this.target.setActionHeld(spec.action, true);
      else this.actions.trigger(spec.action);
    };
    const up = () => {
      if (spec.mode === 'hold') this.target.setActionHeld(spec.action, false);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return el;
  }

  private bindStick(zone: HTMLElement): void {
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== undefined) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      zone.setPointerCapture?.(e.pointerId);
      this.stickOrigin = { x: e.clientX, y: e.clientY };
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const dx = (e.clientX - this.stickOrigin.x) / STICK_RADIUS;
      const dy = (e.clientY - this.stickOrigin.y) / STICK_RADIUS;
      const [x, y] = shapeStick(dx, dy, 0.15);
      this.target.setStick(x, -y);
      if (this.knob) this.knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = undefined;
      this.target.setStick(0, 0);
      if (this.knob) this.knob.style.transform = '';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  private bindLook(zone: HTMLElement): void {
    zone.addEventListener('pointerdown', (e) => {
      if (this.lookId !== undefined) return;
      e.preventDefault();
      this.lookId = e.pointerId;
      zone.setPointerCapture?.(e.pointerId);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const dx = e.clientX - this.lookLast.x;
      const dy = e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.target.look(dx * DRAG_TURN, dy * DRAG_TURN);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = undefined;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  private releaseAll(): void {
    this.stickId = undefined;
    this.lookId = undefined;
    this.target.setStick(0, 0);
    for (const spec of BUTTONS)
      if (spec.mode === 'hold') this.target.setActionHeld(spec.action, false);
  }
}
