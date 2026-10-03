import { h } from '../dom';
import { ResultView } from './ResultView';
import { SqlEditor } from './SqlEditor';

export interface WorkPaneOptions {
  readonly onRun: () => void;
  /** Absent until submitting is wired; the button stays disabled. */
  readonly onSubmit?: () => void;
  readonly onChange?: (value: string) => void;
}

/** Right pane: editor, Run / Submit buttons and the result area. */
export class WorkPane {
  readonly editor: SqlEditor;
  readonly result: ResultView;
  private readonly run: HTMLButtonElement;
  private readonly submit: HTMLButtonElement;
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
      text: 'Submit ✔',
      attrs: {
        type: 'button',
        title: 'Get graded. A wrong answer locks you out for a while. (Ctrl/⌘+Shift+Enter)',
      },
      on: { click: () => options.onSubmit?.() },
    });
    const toolbar = h('div', { class: 'sqlp-toolbar' }, this.run, this.submit);

    host.append(
      editorHost,
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

  private refreshButtons(): void {
    this.run.disabled = this.busy;
    this.submit.disabled = this.busy || this.submitLocked || !this.canSubmit;
  }

  destroy(): void {
    this.editor.destroy();
  }
}
