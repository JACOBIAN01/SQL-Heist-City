import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { h } from '../dom';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  buildCard,
  drawCard,
  type Pen,
  type ShareCardInput,
  type ShareCardOptions,
} from './shareCard';
import './share.css';

/** What the browser can do with a finished picture; tests stand in for it. */
export interface ShareEnv {
  /** Offers the picture as a download. */
  save(name: string, blob: Blob): void;
  /** The device's share sheet, when it can share a file. */
  share?(file: File, title: string): Promise<void>;
}

export function browserShareEnv(): ShareEnv {
  return {
    save(name, blob) {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
    },
    ...(typeof navigator !== 'undefined' && 'share' in navigator && 'canShare' in navigator
      ? {
          share: async (file: File, title: string) => {
            if (navigator.canShare({ files: [file] }))
              await navigator.share({ files: [file], title });
          },
        }
      : {}),
  };
}

/**
 * The round card (Phase 26.8): a picture the student can save or share. It is drawn on their own
 * screen from what they already see, and goes nowhere unless they press a button.
 */
export class ShareCardView {
  readonly root = h('section', { class: 'share', attrs: { 'data-role': 'share' } });
  private readonly canvas = h('canvas', { class: 'share-canvas' });
  private readonly buttons = h('div', { class: 'share-buttons' });
  private ready = false;
  private round = 0;

  constructor(
    private readonly i18n: I18n,
    private readonly env: ShareEnv = browserShareEnv(),
  ) {
    this.canvas.width = CARD_WIDTH;
    this.canvas.height = CARD_HEIGHT;
    i18n.onChange(() => this.draw());
    this.draw();
  }

  private t(key: MessageKey): string {
    return this.i18n.t(key);
  }

  /** The round has ended: draw the card. `options.enabled` false (a school's choice) hides it. */
  update(input: ShareCardInput, options: ShareCardOptions & { enabled: boolean }): void {
    this.root.hidden = !options.enabled;
    if (!options.enabled) return;
    const ctx = this.canvas.getContext('2d');
    this.round = input.round;
    this.ready = ctx !== null;
    if (ctx) drawCard(ctx as unknown as Pen, buildCard(input, options));
    this.draw();
  }

  private draw(): void {
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', this.t('share.alt'));
    const save = h('button', {
      text: this.t('share.save'),
      attrs: { type: 'button', ...(this.ready ? {} : { disabled: '' }) },
      on: { click: () => void this.save() },
    });
    this.buttons.replaceChildren(
      save,
      ...(this.env.share
        ? [
            h('button', {
              text: this.t('share.share'),
              attrs: { type: 'button', ...(this.ready ? {} : { disabled: '' }) },
              on: { click: () => void this.share() },
            }),
          ]
        : []),
    );
    this.root.replaceChildren(
      h('h3', { text: this.t('share.title') }),
      h('p', {
        class: 'share-help',
        text: this.ready ? this.t('share.help') : this.t('share.waiting'),
      }),
      this.canvas,
      this.buttons,
    );
  }

  private blob(): Promise<Blob | null> {
    return new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
  }

  private get filename(): string {
    return `sql-heist-round-${this.round}.png`;
  }

  async save(): Promise<void> {
    const blob = await this.blob();
    if (blob) this.env.save(this.filename, blob);
  }

  async share(): Promise<void> {
    const blob = await this.blob();
    if (blob && this.env.share)
      await this.env.share(
        new File([blob], this.filename, { type: 'image/png' }),
        this.t('share.title'),
      );
  }
}
