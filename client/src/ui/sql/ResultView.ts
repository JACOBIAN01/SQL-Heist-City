import type { SqlCell } from '@heist/shared';
import { clear, h } from '../dom';
import { dataTable } from './DataTable';

export type ResultKind = 'info' | 'error' | 'ok' | 'wrong';

/** Area under the editor: preview rows, errors and (from 4.5) the verdict. */
export class ResultView {
  private readonly host: HTMLElement;

  constructor(parent: HTMLElement) {
    this.host = h('div', { class: 'sqlp-result', attrs: { 'aria-live': 'polite' } });
    parent.append(this.host);
  }

  showIdle(): void {
    clear(this.host);
    this.host.dataset.kind = 'idle';
  }

  showMessage(text: string, kind: ResultKind = 'info'): void {
    clear(this.host);
    this.host.dataset.kind = kind;
    this.host.append(h('p', { class: `sqlp-msg ${kind}`, text }));
  }

  showPreview(
    columns: readonly string[],
    rows: readonly (readonly SqlCell[])[],
    truncated: boolean,
  ): void {
    clear(this.host);
    this.host.dataset.kind = 'preview';
    this.host.append(
      h(
        'div',
        { class: 'sqlp-card-head' },
        h('strong', { text: 'Preview' }),
        h('span', { class: 'sqlp-muted', text: previewNote(rows.length, truncated) }),
      ),
      rows.length === 0
        ? h('p', { class: 'sqlp-muted', text: 'Your query ran but returned no rows.' })
        : dataTable(columns, rows),
      h('p', { class: 'sqlp-muted', text: 'Preview only — nothing is checked until you Submit.' }),
    );
  }

  /** For richer verdicts (4.5): a message followed by arbitrary content. */
  showWith(text: string, kind: ResultKind, ...extra: Node[]): void {
    this.showMessage(text, kind);
    this.host.append(...extra);
  }
}

function previewNote(shown: number, truncated: boolean): string {
  if (shown === 0) return '0 rows';
  return truncated ? `first ${shown} rows` : `${shown} row${shown === 1 ? '' : 's'}`;
}
