import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { sql, SQLite } from '@codemirror/lang-sql';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder as placeholderExt } from '@codemirror/view';
import { tags } from '@lezer/highlight';

export interface SqlEditorOptions {
  placeholder?: string;
  onChange?: (value: string) => void;
  /** Ctrl/Cmd+Enter: free preview. */
  onRun?: () => void;
  /** Ctrl/Cmd+Shift+Enter: graded attempt. */
  onSubmit?: () => void;
}

/** Colours come from CSS variables in sqlPanel.css so the editor matches the panel. */
const highlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.modifier],
    color: 'var(--sqlp-syn-keyword)',
    fontWeight: '600',
  },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--sqlp-syn-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--sqlp-syn-number)' },
  { tag: [tags.typeName, tags.standard(tags.name)], color: 'var(--sqlp-syn-type)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: 'var(--sqlp-muted)',
    fontStyle: 'italic',
  },
  {
    tag: [tags.brace, tags.paren, tags.squareBracket, tags.punctuation],
    color: 'var(--sqlp-muted)',
  },
]);

const theme = EditorView.theme(
  {
    '&': { color: 'var(--sqlp-text)', backgroundColor: 'rgba(0,0,0,0.25)', height: '100%' },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '13px',
    },
    '.cm-content': { caretColor: 'var(--sqlp-text)', minHeight: '9em', padding: '6px 0' },
    '.cm-cursor': { borderLeftColor: 'var(--sqlp-text)' },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--sqlp-muted)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '&.cm-focused': { outline: '1px solid var(--sqlp-accent)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(212,160,23,0.3)',
    },
  },
  { dark: true },
);

/**
 * CodeMirror 6 SQL editor (SQLite dialect) with only the extensions a
 * challenge needs, to keep the bundle small. Esc leaves the editor so the
 * movement keys control the player again.
 */
export class SqlEditor {
  private readonly view: EditorView;
  private readonly readOnly = new Compartment();
  /** True while restoring a draft, so it isn't reported (and saved) as a new edit. */
  private silent = false;

  constructor(
    host: HTMLElement,
    private readonly options: SqlEditorOptions = {},
  ) {
    this.view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          history(),
          bracketMatching(),
          sql({ dialect: SQLite }),
          syntaxHighlighting(highlight),
          theme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'SQL query' }),
          ...(options.placeholder ? [placeholderExt(options.placeholder)] : []),
          this.readOnly.of(EditorState.readOnly.of(false)),
          // Above the default keymap so Mod-Enter doesn't insert a newline.
          Prec.highest(
            keymap.of([
              { key: 'Mod-Enter', run: () => (this.options.onRun?.(), true) },
              { key: 'Mod-Shift-Enter', run: () => (this.options.onSubmit?.(), true) },
              { key: 'Escape', run: (view) => (view.contentDOM.blur(), true) },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.silent)
              this.options.onChange?.(update.state.doc.toString());
          }),
        ],
      }),
    });
  }

  getValue(): string {
    return this.view.state.doc.toString();
  }

  /** Replaces the text without notifying onChange (programmatic change, not typing). */
  setValue(value: string): void {
    if (value === this.getValue()) return;
    this.silent = true;
    try {
      this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value } });
    } finally {
      this.silent = false;
    }
  }

  focus(): void {
    this.view.focus();
  }

  setReadOnly(readOnly: boolean): void {
    this.view.dispatch({ effects: this.readOnly.reconfigure(EditorState.readOnly.of(readOnly)) });
  }

  destroy(): void {
    this.view.destroy();
  }
}
