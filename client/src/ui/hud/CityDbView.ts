import type { CityDbMessage, CityQueryMessage, CityResultMessage } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';
import '../profile/skills.css';

/**
 * The city database terminal (Phase 33): the live tables, the requests on offer and a box to write
 * the SQL that answers one. The server runs it and decides what it is worth; this shows the tables,
 * sends the query and says how it went.
 */
export class CityDbView {
  readonly panel = h('section', {
    class: 'skills citydb-panel',
    attrs: { 'data-role': 'citydb', role: 'dialog', hidden: '' },
  });
  private catalog: CityDbMessage | undefined;
  private selected: string | undefined;
  private sql = '';
  private result: CityResultMessage | undefined;
  private pending = false;
  private ref = 0;

  constructor(
    private readonly i18n: I18n,
    private readonly send: (message: CityQueryMessage) => void,
  ) {
    i18n.onChange(() => this.draw());
    this.draw();
  }

  get hidden(): boolean {
    return Boolean(this.panel.hidden);
  }

  set hidden(value: boolean) {
    this.panel.hidden = value;
  }

  update(catalog: CityDbMessage): void {
    this.catalog = catalog;
    if (!catalog.requests.some((r) => r.id === this.selected))
      this.selected = catalog.requests[0]?.id;
    this.draw();
  }

  /** The server's answer to the last query. */
  answered(result: CityResultMessage): void {
    this.pending = false;
    this.result = result;
    this.draw();
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  private run(): void {
    if (!this.selected || this.pending || this.sql.trim() === '') return;
    this.pending = true;
    this.result = undefined;
    this.send({ t: 'city_query', ref: ++this.ref, request: this.selected, sql: this.sql });
    this.draw();
  }

  private outcome(): HTMLElement | undefined {
    const r = this.result;
    if (this.pending) return h('p', { class: 'skills-help', text: this.t('citydb.running') });
    if (!r) return undefined;
    if (r.ok) {
      const info = r.result;
      const text =
        info?.kind === 'intel'
          ? this.t('citydb.okIntel', { pins: info.pins ?? 0, seconds: info.seconds ?? 0 })
          : info?.kind === 'camera'
            ? this.t('citydb.okCamera', { banks: info.effect ?? '', seconds: info.seconds ?? 0 })
            : this.t('citydb.okDoor', { banks: info?.effect ?? '' });
      return h('p', { class: 'skills-help', text, attrs: { role: 'status' } });
    }
    const why =
      r.reason === 'cooldown'
        ? this.t('citydb.cooldown', { seconds: r.waitSeconds ?? 0 })
        : r.feedback
          ? r.feedback.message
          : this.t(`citydb.denied.${r.reason ?? 'error'}` as MessageKey);
    return h('p', { class: 'menu-error', text: why, attrs: { role: 'alert' } });
  }

  private draw(): void {
    clear(this.panel);
    this.panel.setAttribute('aria-label', this.t('citydb.title'));
    this.panel.appendChild(
      h(
        'header',
        { class: 'skills-head' },
        h('h2', { text: this.t('citydb.title') }),
        h('button', { text: this.t('citydb.close'), on: { click: () => (this.hidden = true) } }),
      ),
    );
    const c = this.catalog;
    if (!c || c.requests.length === 0) {
      this.panel.appendChild(h('p', { class: 'skills-help', text: this.t('citydb.none') }));
      return;
    }
    this.panel.appendChild(h('p', { class: 'skills-help', text: this.t('citydb.help') }));
    const list = h('div', { class: 'citydb-requests' });
    for (const r of c.requests)
      list.appendChild(
        h('button', {
          class: r.id === this.selected ? 'citydb-request on' : 'citydb-request',
          text: `${'★'.repeat(r.tier)} ${r.title}`,
          attrs: { 'data-request': r.id },
          on: {
            click: () => {
              this.selected = r.id;
              this.result = undefined;
              this.draw();
            },
          },
        }),
      );
    this.panel.appendChild(list);
    const request = c.requests.find((r) => r.id === this.selected);
    if (!request) return;
    this.panel.appendChild(h('p', { class: 'citydb-prompt', text: request.prompt }));
    for (const name of request.tables) {
      const table = c.tables.find((x) => x.name === name);
      if (!table) continue;
      this.panel.appendChild(
        h(
          'details',
          { class: 'citydb-table', attrs: { open: '' } },
          h('summary', { text: `${table.name}: ${table.about}` }),
          h('code', {
            text: `${table.name}(${table.columns.map((col) => `${col.name} ${col.type}`).join(', ')})`,
          }),
        ),
      );
    }
    const box = h('textarea', {
      class: 'citydb-sql',
      attrs: { rows: '4', spellcheck: 'false', 'aria-label': this.t('citydb.sql') },
    }) as HTMLTextAreaElement;
    box.value = this.sql;
    box.addEventListener('input', () => (this.sql = box.value));
    this.panel.appendChild(box);
    this.panel.appendChild(
      h('button', {
        text: this.pending ? this.t('citydb.running') : this.t('citydb.run'),
        attrs: { 'data-action': 'run', ...(this.pending ? { disabled: '' } : {}) },
        on: { click: () => this.run() },
      }),
    );
    const out = this.outcome();
    if (out) this.panel.appendChild(out);
  }
}
