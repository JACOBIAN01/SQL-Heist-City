import { h } from '../dom';
import { createResizer } from './Resizer';
import { ResultView } from './ResultView';
import { SqlEditor } from './SqlEditor';

const SUBMIT_LABEL = 'Submit ✔';

export interface WorkPaneOptions {
  readonly onRun: () => void;
  /** Absent until submitting is wired; the button stays disabled. */
  readonly onSubmit?: () => void;
  readonly onHint?: () => void;
  readonly onChange?: (value: string) => void;
}

/** Right pane: editor, Run / Submit buttons and the result area. */
export class WorkPane {
  readonly editor: SqlEditor;
  readonly result: ResultView;
  private readonly run: HTMLButtonElement;
  private readonly submit: HTMLButtonElement;
  private readonly hint: HTMLButtonElement;
  private busy = false;
  private submitLocked = false;
  private readonly canSubmit: boolean;

  constructor(host: HTMLElement, options: WorkPaneOptions) {
    this.canSubmit = options.onSubmit !== undefined;
    const editorHost = h('div', { class: 'sqlp-editor' });
    this.run = h('button', {
      class: 'sqlp-btn',
      text: 'Run ▶',
      attrs: { type: 'button', title: 'Preview the first rows. Free, not graded. (Ctrl/⌘+Enter)' },
      on: { click: () => options.onRun() },
    });
    this.submit = h('button', {
      class: 'sqlp-btn primary',
      text: SUBMIT_LABEL,
      attrs: {
        type: 'button',
        title: 'Get graded. A wrong answer locks you out for a while. (Ctrl/⌘+Shift+Enter)',
      },
      on: { click: () => options.onSubmit?.() },
    });
    this.hint = h('button', {
      class: 'sqlp-btn',
      text: 'Hint',
      attrs: { type: 'button' },
      on: { click: () => options.onHint?.() },
    });
    this.hint.hidden = true;
    const toolbar = h(
      'div',
      { class: 'sqlp-toolbar' },
      this.run,
      this.submit,
      h('span', { class: 'spacer' }),
      this.hint,
    );

    host.append(
      editorHost,
      createResizer({
        axis: 'y',
        direction: 1,
        label: 'Editor height',
        read: () => editorHost.getBoundingClientRect().height,
        apply: (px) => {
          editorHost.style.height = `${px}px`;
        },
        min: () => 72,
        max: () => window.innerHeight * 0.8,
        reset: () => editorHost.style.removeProperty('height'),
        storageKey: 'sqlp.editorHeight',
      }),
      toolbar,
      h(
        'p',
        { class: 'sqlp-keys' },
        h('kbd', { text: 'Ctrl/⌘+Enter' }),
        ' run · ',
        h('kbd', { text: 'Ctrl/⌘+Shift+Enter' }),
        ' submit · ',
        h('kbd', { text: 'Esc' }),
        ' back to the game',
      ),
    );
    this.result = new ResultView(host);
    this.refreshButtons();
    this.editor = new SqlEditor(editorHost, {
      placeholder: 'SELECT …',
      onRun: options.onRun,
      ...(options.onSubmit ? { onSubmit: options.onSubmit } : {}),
      ...(options.onChange ? { onChange: options.onChange } : {}),
    });
  }

  /** Disables the buttons while a request is in flight. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.refreshButtons();
  }

  /** Submit stays off while the server's wrong-answer lockout runs (or while no task exists). */
  setSubmitLocked(locked: boolean): void {
    this.submitLocked = locked;
    this.refreshButtons();
  }

  /** Button text, e.g. "Locked 8 s" during a lockout. Pass nothing to restore the default. */
  setSubmitLabel(label?: string): void {
    this.submit.textContent = label ?? SUBMIT_LABEL;
  }

  /** Shows the next-hint button with its label, or hides it when the task has no (more) hints. */
  setHint(label: string | null, tooltip = ''): void {
    this.hint.hidden = label === null;
    if (label !== null) this.hint.textContent = label;
    this.hint.title = tooltip;
    this.refreshButtons();
  }

  private refreshButtons(): void {
    this.hint.disabled = this.busy;
    this.run.disabled = this.busy;
    this.submit.disabled = this.busy || this.submitLocked || !this.canSubmit;
  }

  destroy(): void {
    this.editor.destroy();
  }
}
