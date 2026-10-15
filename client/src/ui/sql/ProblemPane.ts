import {
  parseInlineMarkdown,
  type HintReveal,
  type PublicChallenge,
  type PublicTable,
  type WorkedExampleView,
} from '@heist/shared';
import { clear, h } from '../dom';
import { dataTable } from './DataTable';
import { hintCostText } from './labels';
import { taskView, type TaskView } from './TaskView';

/** Left pane: the task text, then the tables the query will run against. */
export class ProblemPane {
  private hints: HTMLElement | null = null;
  /** The current task's own view (broken query, options, blanks, brief); null for a plain write task. */
  task: TaskView | null = null;

  constructor(
    private readonly host: HTMLElement,
    /** The tutorial's free solution was asked for: put it in the editor. */
    private readonly onUseSolution: (sql: string) => void = () => {},
  ) {}

  show(challenge: PublicChallenge): void {
    clear(this.host);
    this.hints = h('div', { class: 'sqlp-hints' });
    this.task = challenge.task ? taskView(challenge.task) : null;
    this.host.append(
      h('h2', { class: 'sqlp-h2', text: 'Task' }),
      story(challenge.story),
      ...(this.task ? [this.task.element] : []),
      ...(challenge.solution === undefined ? [] : [this.solution(challenge.solution)]),
      h('h2', { class: 'sqlp-h2', text: challenge.tables.length === 1 ? 'Table' : 'Tables' }),
      ...challenge.tables.map(tableCard),
      ...expectedOutput(challenge),
      h(
        'details',
        { class: 'sqlp-schema' },
        h('summary', { text: 'Show CREATE TABLE statements' }),
        h('pre', { text: challenge.schemaSql }),
      ),
      this.hints,
    );
    this.host.scrollTop = 0;
  }

  /** The tutorial gives the answer away: a button shows it and puts it in the editor. */
  private solution(sql: string): HTMLElement {
    const code = h('pre', { class: 'sqlp-solution-sql', text: sql });
    code.hidden = true;
    const button = h('button', {
      class: 'sqlp-btn sqlp-solution-btn',
      text: 'Show solution (free)',
      attrs: { type: 'button' },
      on: {
        click: () => {
          code.hidden = false;
          button.textContent = 'Put it in the editor again';
          this.onUseSolution(sql);
        },
      },
    });
    return h(
      'div',
      { class: 'sqlp-solution' },
      h('p', { class: 'sqlp-muted', text: 'Tutorial: the answer is free. Read it, then Submit.' }),
      button,
      code,
    );
  }

  /** Shows the hints revealed so far, in order, with what each one cost. */
  showHints(revealed: readonly HintReveal[]): void {
    if (!this.hints) return;
    clear(this.hints);
    if (revealed.length === 0) return;
    this.hints.append(
      h('h2', { class: 'sqlp-h2', text: 'Hints' }),
      ...revealed.map((hint) =>
        h(
          'div',
          { class: 'sqlp-hint' },
          h('div', {
            class: 'sqlp-muted',
            text: `Hint ${hint.index + 1} · ${hintCostText(hint.cost, hint.costMode)}`,
          }),
          h('p', { class: 'sqlp-line', text: hint.text }),
        ),
      ),
    );
  }

  /** Placeholder text while there is no challenge (loading, error, expired). */
  showMessage(text: string): void {
    clear(this.host);
    this.hints = null;
    this.task = null;
    this.host.append(h('p', { class: 'sqlp-muted', text }));
  }
}

function story(markdown: string): HTMLElement {
  const box = h('div', { class: 'sqlp-story' });
  for (const tokens of parseInlineMarkdown(markdown)) {
    const line = h('p', { class: 'sqlp-line' });
    for (const t of tokens) {
      // Text nodes and elements only — never innerHTML.
      line.append(
        t.kind === 'bold'
          ? h('strong', { text: t.text })
          : t.kind === 'code'
            ? h('code', { text: t.text })
            : t.text,
      );
    }
    box.append(line);
  }
  return box;
}

function tableCard(table: PublicTable): HTMLElement {
  const more = table.rowCount - table.sampleRows.length;
  return h(
    'div',
    { class: 'sqlp-card' },
    h(
      'div',
      { class: 'sqlp-card-head' },
      h('code', { text: table.name }),
      h('span', { class: 'sqlp-muted', text: `${table.rowCount} rows` }),
    ),
    dataTable(table.columns, table.sampleRows),
    more > 0 ? h('p', { class: 'sqlp-muted', text: `…and ${more} more rows` }) : null,
  );
}

/** What the answer must look like, in words. */
export function answerRules(challenge: PublicChallenge): string {
  const columns = challenge.columnsMatter
    ? 'Use exactly these column names, in this order.'
    : "Return these columns in this order; their names don't have to match.";
  const rows = challenge.orderMatters
    ? 'Rows must come in this order.'
    : 'Rows can come in any order.';
  return `${columns} ${rows}`;
}

/**
 * The expected output: its columns, then a worked example (the same task on
 * made-up rows, never the player's real tables) showing input and output.
 */
function expectedOutput(challenge: PublicChallenge): HTMLElement[] {
  const example = challenge.example;
  if (!example) return [];
  return [
    h('h2', { class: 'sqlp-h2', text: 'Expected output' }),
    h('p', { class: 'sqlp-muted sqlp-rules', text: answerRules(challenge) }),
    h('div', { class: 'sqlp-card sqlp-output-shape' }, dataTable(example.output.columns, [])),
    workedExample(example),
  ];
}

function workedExample(example: WorkedExampleView): HTMLElement {
  const { output } = example;
  const more = output.rowCount - output.rows.length;
  return h(
    'details',
    { class: 'sqlp-example', attrs: { open: '' } },
    h('summary', { text: 'Example' }),
    h('p', {
      class: 'sqlp-muted',
      text: 'Made-up example rows (not your tables). On these rows, the right query returns the output below.',
    }),
    h('div', { class: 'sqlp-example-label', text: 'Input' }),
    ...example.tables.map(tableCard),
    h('div', { class: 'sqlp-example-label', text: 'Output' }),
    h(
      'div',
      { class: 'sqlp-card' },
      output.rowCount === 0
        ? h('p', { class: 'sqlp-muted', text: '(no rows)' })
        : dataTable(output.columns, output.rows),
      more > 0 ? h('p', { class: 'sqlp-muted', text: `…and ${more} more rows` }) : null,
    ),
  );
}
