import type { SqlCell } from '@heist/shared';
import { h } from '../dom';

/** Read-only table for sample rows and query results. NULL is shown, not hidden. */
export function dataTable(
  columns: readonly string[],
  rows: readonly (readonly SqlCell[])[],
): HTMLElement {
  return h(
    'div',
    { class: 'sqlp-table-wrap' },
    h(
      'table',
      { class: 'sqlp-table' },
      h('thead', {}, h('tr', {}, ...columns.map((c) => h('th', { text: c })))),
      h(
        'tbody',
        {},
        ...rows.map((row) =>
          h(
            'tr',
            {},
            ...row.map((cell) =>
              cell === null
                ? h('td', { class: 'null', text: 'NULL' })
                : h('td', { class: typeof cell === 'number' ? 'num' : '', text: String(cell) }),
            ),
          ),
        ),
      ),
    ),
  );
}
