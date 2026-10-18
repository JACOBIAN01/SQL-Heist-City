import {
  ACTIONS,
  DEFAULT_KEYS,
  GRAPHICS,
  LOCALES,
  PALETTES,
  RESERVED_KEYS,
  keyConflicts,
  keyLabel,
  keysFor,
  type Action,
  type PlayerSettings,
} from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import type { SettingsStore } from '../../settings/SettingsStore';
import { clear, h } from '../dom';
import './settings.css';

const TABS = ['controls', 'audio', 'graphics', 'access', 'language'] as const;
type Tab = (typeof TABS)[number];

const LANGUAGE_NAMES: Readonly<Record<string, string>> = { en: 'English', hi: 'हिन्दी' };
const MOUSE_CODES = ['Mouse0', 'Mouse1', 'Mouse2'];
const MAX_KEYS_PER_ACTION = 4;

/**
 * The settings panel (Phase 22): one place for controls, sound, graphics, accessibility and
 * language. It only edits the store; everything that reacts (input, audio, camera, CSS) listens to
 * the store, so the panel works the same from the menu and from inside a match.
 *
 * Pattern: Mediator — Why: the controls never talk to each other or to the game; they all go
 * through the settings store, so adding a setting touches this file and its listener only.
 */
export class SettingsPanel {
  readonly root = h('div', {
    class: 'settings-overlay',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'data-role': 'settings', hidden: '' },
  });
  private tab: Tab = 'controls';
  private capturing: { action: Action; replace: string | null } | undefined;
  private note = '';
  private opener: Element | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: SettingsStore,
    private readonly i18n: I18n,
    private readonly onClose: () => void = () => {},
  ) {
    this.root.addEventListener('keydown', this.onKey, true);
    this.root.addEventListener('mousedown', this.onMouse, true);
    this.root.addEventListener('contextmenu', (e) => this.capturing && e.preventDefault());
    this.unsubscribe = i18n.onChange(() => this.isOpen && this.render());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(parent: HTMLElement = document.body): void {
    if (!this.root.isConnected) parent.appendChild(this.root);
    this.opener = document.activeElement;
    this.root.hidden = false;
    this.render();
    this.root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.capturing = undefined;
    this.root.hidden = true;
    if (this.opener instanceof HTMLElement) this.opener.focus();
    this.onClose();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  dispose(): void {
    this.unsubscribe();
    this.root.remove();
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  private get s(): PlayerSettings {
    return this.store.current;
  }

  private update(change: (s: PlayerSettings) => PlayerSettings): void {
    this.store.set(change(this.s));
  }

  // --- key capture ----------------------------------------------------------------------

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.capturing) {
        this.capturing = undefined;
        this.render();
      } else this.close();
      return;
    }
    if (!this.capturing) return;
    event.preventDefault();
    event.stopPropagation();
    this.assign(event.code);
  };

  private readonly onMouse = (event: MouseEvent): void => {
    if (!this.capturing || event.button > 2) return;
    event.preventDefault();
    event.stopPropagation();
    this.assign(MOUSE_CODES[event.button] ?? 'Mouse0');
  };

  private assign(code: string): void {
    const capture = this.capturing;
    this.capturing = undefined;
    if (!capture) return;
    if (RESERVED_KEYS.has(code) || !/^[A-Za-z0-9]{2,20}$/.test(code)) {
      this.note = this.t('settings.keyReserved', { key: keyLabel(code) });
      return this.render();
    }
    this.note = '';
    const current = [...keysFor(this.s, capture.action)];
    const at = capture.replace === null ? -1 : current.indexOf(capture.replace);
    if (at >= 0) current[at] = code;
    else current.push(code);
    this.setKeys(capture.action, [...new Set(current)].slice(0, MAX_KEYS_PER_ACTION));
  }

  private setKeys(action: Action, keys: string[] | undefined): void {
    this.update((s) => {
      const { [action]: _gone, ...rest } = s.keys;
      return { ...s, keys: keys ? { ...rest, [action]: keys } : rest };
    });
    this.render();
  }

  // --- drawing --------------------------------------------------------------------------

  private render(): void {
    clear(this.root);
    this.root.setAttribute('aria-label', this.t('settings.title'));
    const body = h('div', { class: 'settings-body', attrs: { role: 'tabpanel' } });
    this.root.appendChild(
      h(
        'div',
        { class: 'settings-card' },
        h(
          'header',
          { class: 'settings-head' },
          h('h2', { text: this.t('settings.title') }),
          h('button', {
            class: 'settings-close',
            text: this.t('settings.close'),
            on: { click: () => this.close() },
          }),
        ),
        h(
          'div',
          { class: 'settings-tabs', attrs: { role: 'tablist' } },
          ...TABS.map((tab) =>
            h('button', {
              text: this.t(`settings.tab.${tab}` as MessageKey),
              attrs: { role: 'tab', 'aria-selected': String(tab === this.tab) },
              on: {
                click: () => {
                  this.tab = tab;
                  this.note = '';
                  this.render();
                  this.root
                    .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
                    ?.focus();
                },
              },
            }),
          ),
        ),
        body,
        h('footer', { class: 'settings-foot' }, this.resetButton()),
      ),
    );
    body.append(...this.panelFor(this.tab));
  }

  private resetButton(): HTMLElement {
    return h('button', {
      class: 'menu-quiet',
      text: this.t('settings.reset'),
      on: {
        click: () => {
          this.store.reset();
          this.note = '';
          this.render();
        },
      },
    });
  }

  private panelFor(tab: Tab): HTMLElement[] {
    switch (tab) {
      case 'controls':
        return this.controls();
      case 'audio':
        return [
          this.slider('settings.master', this.s.audio.master, 0, 1, 0.05, (v) =>
            this.update((s) => ({ ...s, audio: { ...s.audio, master: v } })),
          ),
          this.slider('settings.effects', this.s.audio.effects, 0, 1, 0.05, (v) =>
            this.update((s) => ({ ...s, audio: { ...s.audio, effects: v } })),
          ),
          this.slider('settings.ambience', this.s.audio.ambience, 0, 1, 0.05, (v) =>
            this.update((s) => ({ ...s, audio: { ...s.audio, ambience: v } })),
          ),
        ];
      case 'graphics':
        return [
          this.select(
            'settings.quality',
            this.s.graphics.quality,
            GRAPHICS.map((g) => [g, this.t(`settings.quality.${g}` as MessageKey)]),
            (v) =>
              this.update((s) => ({
                ...s,
                graphics: { quality: v as PlayerSettings['graphics']['quality'] },
              })),
          ),
          h('p', { class: 'menu-muted', text: this.t('settings.qualityHelp') }),
        ];
      case 'access':
        return this.access();
      case 'language':
        return [
          this.select(
            'settings.language',
            this.s.locale,
            LOCALES.map((l) => [l, LANGUAGE_NAMES[l] ?? l]),
            (v) => {
              this.update((s) => ({ ...s, locale: v as PlayerSettings['locale'] }));
              this.i18n.setLocale(this.s.locale);
            },
          ),
          h('p', { class: 'menu-muted', text: this.t('settings.languageNote') }),
        ];
    }
  }

  private controls(): HTMLElement[] {
    const conflicts = keyConflicts(this.s);
    const clashing = (action: Action, key: string) =>
      conflicts.find((c) => c.key === key && c.actions.includes(action));
    const rows = ACTIONS.map((action) => {
      const keys = keysFor(this.s, action);
      const changed = this.s.keys[action] !== undefined;
      const capturing = this.capturing?.action === action;
      const chips = keys.map((key) => {
        const clash = clashing(action, key);
        const others = clash?.actions
          .filter((a) => a !== action)
          .map((a) => this.t(`action.${a}` as MessageKey))
          .join(', ');
        return h(
          'span',
          { class: `settings-key${clash ? ' settings-clash' : ''}` },
          h('button', {
            text: keyLabel(key),
            attrs: clash ? { title: this.t('settings.conflict', { actions: others ?? '' }) } : {},
            on: {
              click: () => {
                this.capturing = { action, replace: key };
                this.render();
              },
            },
          }),
          keys.length > 1
            ? h('button', {
                class: 'settings-remove',
                text: '×',
                attrs: { 'aria-label': this.t('settings.removeKey', { key: keyLabel(key) }) },
                on: {
                  click: () =>
                    this.setKeys(
                      action,
                      keys.filter((k) => k !== key),
                    ),
                },
              })
            : null,
        );
      });
      return h(
        'div',
        { class: 'settings-action', attrs: { 'data-action': action } },
        h('span', { class: 'settings-name', text: this.t(`action.${action}` as MessageKey) }),
        h('span', { class: 'settings-keys' }, ...chips),
        capturing
          ? h('span', {
              class: 'settings-press',
              text: this.t('settings.pressKey'),
              attrs: { role: 'status' },
            })
          : keys.length < MAX_KEYS_PER_ACTION
            ? h('button', {
                class: 'menu-quiet',
                text: this.t('settings.addKey'),
                on: {
                  click: () => {
                    this.capturing = { action, replace: null };
                    this.render();
                  },
                },
              })
            : null,
        changed
          ? h('button', {
              class: 'menu-quiet',
              text: this.t('settings.resetKeys'),
              on: { click: () => this.setKeys(action, undefined) },
            })
          : null,
      );
    });
    return [
      h('h3', { text: this.t('settings.look') }),
      this.slider('settings.sensitivity', this.s.look.sensitivity, 0.2, 3, 0.1, (v) =>
        this.update((s) => ({ ...s, look: { ...s.look, sensitivity: v } })),
      ),
      this.slider('settings.fov', this.s.look.fov, 60, 100, 1, (v) =>
        this.update((s) => ({ ...s, look: { ...s.look, fov: v } })),
      ),
      this.check('settings.invertY', this.s.look.invertY, (v) =>
        this.update((s) => ({ ...s, look: { ...s.look, invertY: v } })),
      ),
      h('h3', { text: this.t('settings.keys') }),
      h('p', { class: 'menu-muted', text: this.t('settings.keysHelp') }),
      conflicts.length ? h('p', { class: 'menu-error', text: this.t('settings.conflicts') }) : null,
      this.note ? h('p', { class: 'menu-error', text: this.note, attrs: { role: 'alert' } }) : null,
      ...rows,
      h('h3', { text: this.t('settings.gamepad') }),
      this.slider('settings.deadzone', this.s.gamepad.deadzone, 0.05, 0.5, 0.01, (v) =>
        this.update((s) => ({ ...s, gamepad: { ...s.gamepad, deadzone: v } })),
      ),
      this.slider('settings.gamepadSensitivity', this.s.gamepad.sensitivity, 0.3, 3, 0.1, (v) =>
        this.update((s) => ({ ...s, gamepad: { ...s.gamepad, sensitivity: v } })),
      ),
      h('h3', { text: this.t('settings.touch') }),
      this.select(
        'settings.touchShow',
        this.s.touch.controls,
        [
          ['auto', this.t('settings.touchAuto')],
          ['on', this.t('settings.touchOn')],
          ['off', this.t('settings.touchOff')],
        ],
        (v) =>
          this.update((s) => ({
            ...s,
            touch: { ...s.touch, controls: v as PlayerSettings['touch']['controls'] },
          })),
      ),
      this.check('settings.leftHanded', this.s.touch.leftHanded, (v) =>
        this.update((s) => ({ ...s, touch: { ...s.touch, leftHanded: v } })),
      ),
    ].filter((n): n is HTMLElement => n !== null);
  }

  private access(): HTMLElement[] {
    return [
      this.slider('settings.textScale', this.s.access.textScale, 0.85, 1.6, 0.05, (v) =>
        this.update((s) => ({ ...s, access: { ...s.access, textScale: v } })),
      ),
      this.select(
        'settings.palette',
        this.s.access.palette,
        PALETTES.map((p) => [p, this.t(`palette.${p}` as MessageKey)]),
        (v) =>
          this.update((s) => ({
            ...s,
            access: { ...s.access, palette: v as PlayerSettings['access']['palette'] },
          })),
      ),
      this.select(
        'settings.reducedMotion',
        this.s.access.reducedMotion,
        [
          ['system', this.t('settings.motion.system')],
          ['on', this.t('settings.motion.on')],
          ['off', this.t('settings.motion.off')],
        ],
        (v) =>
          this.update((s) => ({
            ...s,
            access: { ...s.access, reducedMotion: v as PlayerSettings['access']['reducedMotion'] },
          })),
      ),
      this.check('settings.subtitles', this.s.access.subtitles, (v) =>
        this.update((s) => ({ ...s, access: { ...s.access, subtitles: v } })),
      ),
    ];
  }

  // --- controls -------------------------------------------------------------------------

  private slider(
    label: MessageKey,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
  ): HTMLElement {
    const shown = h('output', { text: String(round(value)) });
    const input = h('input', {
      attrs: {
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(value),
      },
      on: {
        input: () => (shown.textContent = String(round(Number(input.value)))),
        change: () => onChange(Number(input.value)),
      },
    });
    return h('label', { class: 'settings-row' }, h('span', { text: this.t(label) }), input, shown);
  }

  private check(label: MessageKey, value: boolean, onChange: (v: boolean) => void): HTMLElement {
    const input = h('input', {
      attrs: { type: 'checkbox', ...(value ? { checked: '' } : {}) },
      on: { change: () => onChange(input.checked) },
    });
    input.checked = value;
    return h('label', { class: 'settings-row' }, input, h('span', { text: this.t(label) }));
  }

  private select(
    label: MessageKey,
    value: string,
    options: readonly (readonly [string, string])[],
    onChange: (v: string) => void,
  ): HTMLElement {
    const input = h(
      'select',
      { on: { change: () => onChange(input.value) } },
      ...options.map(([v, text]) => h('option', { text, attrs: { value: v } })),
    );
    input.value = value;
    return h('label', { class: 'settings-row' }, h('span', { text: this.t(label) }), input);
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

/** What an action's keys are when the player has changed nothing. */
export const defaultKeysFor = (action: Action): readonly string[] => DEFAULT_KEYS[action];
