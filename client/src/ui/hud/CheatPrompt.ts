import type { CheatOutcome, CheatRefusal } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { h } from '../dom';

const REASONS: Readonly<Record<CheatRefusal, MessageKey>> = {
  wrong: 'cheat.wrong',
  locked: 'cheat.locked',
  limit: 'cheat.limit',
  no_task: 'cheat.no_task',
  refused: 'cheat.refused',
};

/**
 * The cheat prompt (Phase 37): a small box for the code, opened by the secret key combination. It
 * only asks and shows the answer; the server decides, and the box says nothing about the feature
 * until the combination is pressed.
 */
export class CheatPrompt {
  readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly note: HTMLElement;
  private busy = false;

  constructor(
    private readonly i18n: I18n,
    /** Sends the code for the open question; resolves with the outcome, or `no_task` when none is open. */
    private readonly submit: (code: string) => Promise<CheatOutcome | 'no_task'>,
  ) {
    this.input = h('input', {
      class: 'cheat-input',
      attrs: {
        type: 'password',
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': i18n.t('cheat.label'),
        maxlength: '100',
      },
    }) as HTMLInputElement;
    this.note = h('p', { class: 'cheat-note', attrs: { role: 'status' } });
    this.root = h(
      'form',
      { class: 'cheat-prompt', attrs: { 'data-role': 'cheat', hidden: '' } },
      h('label', { text: i18n.t('cheat.label') }),
      this.input,
      this.note,
    );
    this.root.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.send();
    });
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing the code must not walk, shoot or open panels
      if ((e as KeyboardEvent).key === 'Escape') this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.input.value = '';
    this.note.textContent = '';
    this.root.hidden = false;
    this.input.focus();
  }

  close(): void {
    this.input.value = '';
    this.root.hidden = true;
  }

  private async send(): Promise<void> {
    const code = this.input.value;
    if (!code || this.busy) return;
    this.busy = true;
    this.input.value = '';
    try {
      const outcome = await this.submit(code);
      if (outcome !== 'no_task' && outcome.ok) return this.close();
      const key: MessageKey = outcome === 'no_task' ? 'cheat.no_task' : REASONS[outcome.reason];
      this.note.textContent = this.i18n.t(key);
    } finally {
      this.busy = false;
    }
  }
}
