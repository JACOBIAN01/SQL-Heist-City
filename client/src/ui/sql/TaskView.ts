import type { PublicTask, TaskAnswer } from '@heist/shared';
import { h } from '../dom';
import { dataTable } from './DataTable';

/** What the pop-up shows for a task kind, and the answer it collects (non-SQL kinds). */
export interface TaskView {
  readonly element: HTMLElement;
  /** The SQL to start the editor with (the broken or slow query), if any. */
  readonly startSql?: string;
  /** Whether the answer is in the form (choice, fill, brief) rather than only the editor. */
  readonly formAnswer: boolean;
  /** Whether the editor is used at all. */
  readonly usesEditor: boolean;
  answer(): TaskAnswer;
}

const section = (title: string, ...children: (HTMLElement | null)[]) =>
  h('div', { class: 'sqlp-task' }, h('h2', { class: 'sqlp-h2', text: title }), ...children);
const code = (sql: string) => h('pre', { class: 'sqlp-task-sql', text: sql });
const note = (text: string) => h('p', { class: 'sqlp-muted', text });

/**
 * Builds the view for one task kind.
 *
 * Pattern: Strategy (by kind, matching the server's task handlers) — Why: each kind's form and
 * answer stay in one small function; the controller only asks for `answer()`.
 */
export function taskView(task: PublicTask, onAnswerChange: () => void = () => {}): TaskView | null {
  switch (task.kind) {
    case 'write':
      return null;
    case 'fix':
      return {
        element: section(
          'The broken query',
          note(
            'This query does not work. It is in the editor: fix it so it returns the right rows.',
          ),
          code(task.brokenSql),
        ),
        startSql: task.brokenSql,
        formAnswer: false,
        usesEditor: true,
        answer: () => ({}),
      };
    case 'faster':
      return {
        element: section(
          'The slow query',
          note(
            `This query is right but reads whole tables. Return the same rows with at most ${task.maxScans} full table scan${task.maxScans === 1 ? '' : 's'} (use an index).`,
          ),
          code(task.slowSql),
        ),
        startSql: task.slowSql,
        formAnswer: false,
        usesEditor: true,
        answer: () => ({}),
      };
    case 'write_db':
      return {
        element: section(
          'Change the data',
          note(
            'Write INSERT, UPDATE or DELETE statements (or CREATE TABLE / INDEX). Run only previews SELECTs; Submit applies your statements, and you are marked on how the tables look afterwards.',
          ),
        ),
        formAnswer: false,
        usesEditor: true,
        answer: () => ({}),
      };
    case 'choice':
      return choiceView(task, onAnswerChange);
    case 'fill':
      return fillView(task, onAnswerChange);
    case 'brief':
      return briefView(task, onAnswerChange);
  }
}

function choiceView(task: Extract<PublicTask, { kind: 'choice' }>, onChange: () => void): TaskView {
  const picks: Set<string>[] = task.parts.map(() => new Set());
  const shown = task.shown;
  const element = section(
    task.parts.length === 1 ? 'Your answer' : 'Your answers',
    task.shownSql ? code(task.shownSql) : null,
    shown?.kind === 'result'
      ? h('div', { class: 'sqlp-card' }, dataTable(shown.columns, shown.rows))
      : shown?.kind === 'error'
        ? h('p', { class: 'sqlp-task-error', text: shown.message })
        : shown?.kind === 'plan'
          ? h('pre', { class: 'sqlp-task-plan', text: shown.lines.join('\n') })
          : null,
    note('One go: your answer is final when you submit.'),
    ...task.parts.map((part, i) =>
      h(
        'fieldset',
        { class: 'sqlp-choice' },
        h('legend', { text: part.prompt }),
        part.multi ? note('Pick every right option.') : null,
        ...part.options.map((o) =>
          h(
            'label',
            { class: 'sqlp-option' },
            h('input', {
              attrs: { type: part.multi ? 'checkbox' : 'radio', name: `part-${i}`, value: o.id },
              on: {
                change: (e) => {
                  const box = e.target as HTMLInputElement;
                  const set = picks[i] as Set<string>;
                  if (!part.multi) set.clear();
                  if (box.checked) set.add(o.id);
                  else set.delete(o.id);
                  onChange();
                },
              },
            }),
            ` ${o.text}`,
          ),
        ),
      ),
    ),
  );
  return {
    element,
    formAnswer: true,
    usesEditor: false,
    answer: () => ({ choices: picks.map((s) => [...s]) }),
  };
}

function fillView(task: Extract<PublicTask, { kind: 'fill' }>, onChange: () => void): TaskView {
  const inputs: HTMLInputElement[] = [];
  const pieces = task.textSql.split('___');
  const line = h('pre', { class: 'sqlp-task-sql sqlp-fill' });
  pieces.forEach((text, i) => {
    line.append(text);
    if (i < pieces.length - 1) {
      const input = h('input', {
        class: 'sqlp-blank',
        attrs: { type: 'text', 'aria-label': `Blank ${i + 1}`, size: '10', spellcheck: 'false' },
        on: { input: () => onChange() },
      });
      inputs.push(input);
      line.append(input);
    }
  });
  return {
    element: section(
      'Fill the blanks',
      note('One go: your answer is final when you submit.'),
      line,
    ),
    formAnswer: true,
    usesEditor: false,
    answer: () => ({ blanks: inputs.map((i) => i.value) }),
  };
}

function briefView(task: Extract<PublicTask, { kind: 'brief' }>, onChange: () => void): TaskView {
  const text = h('textarea', {
    class: 'sqlp-brief',
    attrs: {
      rows: '8',
      'aria-label': 'Your write-up',
      placeholder: 'Goal: …\nDone when: …\nHow I know it worked: …',
    },
    on: { input: () => onChange() },
  });
  return {
    element: section(
      'Your write-up',
      note(
        'Say what you are trying to find out, when you are done, and how you know it worked. Put your queries in the editor (Run them as often as you like). A teacher marks it later.',
      ),
      h(
        'ul',
        { class: 'sqlp-rubric' },
        ...task.rubric.map((r) =>
          h('li', { text: `${r.criterion} (${r.marks} mark${r.marks === 1 ? '' : 's'})` }),
        ),
      ),
      text,
    ),
    formAnswer: true,
    usesEditor: true,
    answer: () => ({ text: text.value }),
  };
}
