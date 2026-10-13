import {
  autocompletion,
  completionStatus,
  currentCompletions,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { keywordCompletionSource, schemaCompletionSource, sql, SQLite } from '@codemirror/lang-sql';
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
  /** What autocomplete offers: SQL keywords and this challenge's own tables and columns. */
  private readonly completion = new Compartment();
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
          this.completion.of(completionFor([])),
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

  /**
   * Autocomplete offers these tables and columns (and SQL keywords), nothing else:
   * names from another question never show up.
   */
  setSchema(tables: readonly { name: string; columns: readonly string[] }[]): void {
    this.view.dispatch({ effects: this.completion.reconfigure(completionFor(tables)) });
  }

  /** The names autocomplete would offer for a prefix, for tests. */
  completionsFor(text: string): Promise<string[]> {
    return completionLabels(this.view, text);
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

/** Types `text` at the end of the document, asks for completions, and returns their labels. */
async function completionLabels(view: EditorView, text: string): Promise<string[]> {
  view.dispatch({
    changes: { from: view.state.doc.length, insert: text },
    selection: { anchor: view.state.doc.length + text.length },
  });
  startCompletion(view);
  for (let i = 0; i < 40 && completionStatus(view.state) !== 'active'; i++)
    await new Promise((r) => setTimeout(r, 10));
  return currentCompletions(view.state).map((c) => c.label);
}

/** Every column of this challenge's tables, offered by its bare name (with the table it belongs to). */
function columnSource(tables: readonly { name: string; columns: readonly string[] }[]) {
  const options = tables.flatMap((t) =>
    t.columns.map((c) => ({ label: c, type: 'property', detail: t.name })),
  );
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/\w+/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    return { from: word.from, options, validFor: /^\w*$/ };
  };
}

/**
 * The completion sources for a challenge: SQL keywords, its tables (and `table.column`), and every
 * column by its bare name. Nothing from any other question is ever offered.
 */
function completionFor(tables: readonly { name: string; columns: readonly string[] }[]) {
  const schema = Object.fromEntries(tables.map((t) => [t.name, [...t.columns]]));
  const config = { dialect: SQLite, schema, upperCaseKeywords: true };
  return autocompletion({
    activateOnTyping: true,
    icons: false,
    override: [
      keywordCompletionSource(SQLite, true),
      schemaCompletionSource(config),
      columnSource(tables),
    ],
  });
}
