import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { sql, SQLite } from '@codemirror/lang-sql';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder as placeholderExt } from '@codemirror/view';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: 'sql' | 'json';
  label: string;
  placeholder?: string;
  minLines?: number;
}

/** Token colours come from CSS variables, so they follow the light/dark theme. */
const themedHighlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.modifier],
    color: 'var(--syn-keyword)',
    fontWeight: '600',
  },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syn-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syn-number)' },
  { tag: [tags.typeName, tags.standard(tags.name)], color: 'var(--syn-type)' },
  { tag: [tags.propertyName], color: 'var(--syn-property)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: 'var(--muted)',
    fontStyle: 'italic',
  },
  { tag: [tags.brace, tags.paren, tags.squareBracket, tags.punctuation], color: 'var(--muted)' },
]);

/**
 * Small CodeMirror 6 wrapper (only the extensions we need, to keep the
 * bundle light). Controlled: external `value` changes replace the document.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  label,
  placeholder,
  minLines = 4,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          bracketMatching(),
          syntaxHighlighting(themedHighlight),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          language === 'sql' ? sql({ dialect: SQLite }) : json(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.theme({ '.cm-content': { minHeight: `${minLines * 1.4}em` } }),
          ...(placeholder ? [placeholderExt(placeholder)] : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // Recreate only when the language changes; value is synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div className="cm-host" ref={host} />;
}
