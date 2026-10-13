import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlEditor } from './SqlEditor';

let host: HTMLElement;
let editor: SqlEditor | undefined;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  editor?.destroy();
  editor = undefined;
  host.remove();
});

const content = () => host.querySelector('.cm-content') as HTMLElement;

describe('SqlEditor', () => {
  it('mounts an accessible, editable SQL editor', () => {
    editor = new SqlEditor(host, { placeholder: 'SELECT …' });
    expect(content().getAttribute('aria-label')).toBe('SQL query');
    expect(content().getAttribute('contenteditable')).toBe('true');
    expect(host.querySelector('.cm-placeholder')?.textContent).toBe('SELECT …');
  });

  it('highlights SQL keywords with a token class', () => {
    editor = new SqlEditor(host);
    editor.setValue('SELECT name FROM employees');
    // lang-sql tokenises keywords; HighlightStyle gives them a generated class.
    const spans = host.querySelectorAll('.cm-line span');
    expect(spans.length).toBeGreaterThan(0);
  });

  it('reads and writes the value; setValue does not count as typing', () => {
    const onChange = vi.fn();
    editor = new SqlEditor(host, { onChange });
    editor.setValue('SELECT 1');
    expect(editor.getValue()).toBe('SELECT 1');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('can be made read-only', () => {
    editor = new SqlEditor(host);
    editor.setReadOnly(true);
    expect(content().getAttribute('aria-readonly')).toBe('true');
    editor.setReadOnly(false);
    expect(content().getAttribute('aria-readonly')).toBeNull();
  });

  it('Ctrl+Enter runs, Ctrl+Shift+Enter submits, and neither inserts a newline', () => {
    const onRun = vi.fn();
    const onSubmit = vi.fn();
    editor = new SqlEditor(host, { onRun, onSubmit });
    editor.setValue('SELECT 1');
    const press = (init: KeyboardEventInit) =>
      content().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }),
      );
    // CodeMirror's "Mod" is Ctrl here (jsdom reports no Mac platform) and Cmd on a Mac.
    press({ ctrlKey: true });
    press({ ctrlKey: true, shiftKey: true });
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(editor.getValue()).toBe('SELECT 1');
  });

  it('typing is reported through onChange', () => {
    const onChange = vi.fn();
    editor = new SqlEditor(host, { onChange });
    content().focus();
    // Drive a real edit through the editor's own transaction path.
    editor['view'].dispatch({ changes: { from: 0, insert: 'SELECT' }, userEvent: 'input.type' });
    expect(onChange).toHaveBeenLastCalledWith('SELECT');
  });

  it('autocompletes only this challenge’s tables and columns (16.5)', async () => {
    editor = new SqlEditor(host);
    editor.setSchema([
      { name: 'employees', columns: ['id', 'first_name', 'salary'] },
      { name: 'branches', columns: ['id', 'city'] },
    ]);
    const tables = await editor.completionsFor('SELECT * FROM emp');
    expect(tables).toContain('employees');
    expect(tables).not.toContain('departments');
    editor.setValue('');
    const columns = await editor.completionsFor('SELECT first_');
    expect(columns).toContain('first_name');
  });

  it('forgets the previous question’s names when a new one is shown', async () => {
    editor = new SqlEditor(host);
    editor.setSchema([{ name: 'employees', columns: ['salary'] }]);
    editor.setSchema([{ name: 'accounts', columns: ['balance'] }]);
    editor.setValue('');
    expect(await editor.completionsFor('SELECT * FROM emp')).not.toContain('employees');
    editor.setValue('');
    expect(await editor.completionsFor('SELECT * FROM acc')).toContain('accounts');
  });
});
