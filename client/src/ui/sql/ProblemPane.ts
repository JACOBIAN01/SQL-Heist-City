import { parseInlineMarkdown, type PublicChallenge, type PublicTable } from '@heist/shared';
import { clear, h } from '../dom';
import { dataTable } from './DataTable';

/** Left pane: the task text, then the tables the query will run against. */
export class ProblemPane {
  constructor(private readonly host: HTMLElement) {}

  show(challenge: PublicChallenge): void {
    clear(this.host);
    this.host.append(
      h('h2', { class: 'sqlp-h2', text: 'Task' }),
      story(challenge.story),
      h('h2', { class: 'sqlp-h2', text: challenge.tables.length === 1 ? 'Table' : 'Tables' }),
      ...challenge.tables.map(tableCard),
      h(
        'details',
        { class: 'sqlp-schema' },
        h('summary', { text: 'Show CREATE TABLE statements' }),
        h('pre', { text: challenge.schemaSql }),
      ),
    );
    this.host.scrollTop = 0;
  }

  /** Placeholder text while there is no challenge (loading, error, expired). */
  showMessage(text: string): void {
    clear(this.host);
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
