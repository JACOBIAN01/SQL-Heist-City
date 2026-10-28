import type {
  CityDbMessage,
  CityQueryMessage,
  CityResultMessage,
  SplitStateMessage,
  SplitSubmitMessage,
} from '@heist/shared';
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
  /** The part of a split the student is writing (0–2), and where each split stands. */
  private part = 0;
  private readonly splitStates = new Map<string, SplitStateMessage>();

  constructor(
    private readonly i18n: I18n,
    private readonly send: (message: CityQueryMessage | SplitSubmitMessage) => void,
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

  /** Where a squad's split query stands (Phase 34.2). */
  splitState(message: SplitStateMessage): void {
    this.splitStates.set(message.split, message);
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
    if (this.selected.startsWith('split:'))
      this.send({
        t: 'split_submit',
        ref: ++this.ref,
        split: this.selected.slice('split:'.length),
        part: this.part,
        sql: this.sql,
      });
    else this.send({ t: 'city_query', ref: ++this.ref, request: this.selected, sql: this.sql });
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

  /** The squad's three-part query: what each part is, who has done it, and which one I am writing. */
  private drawSplit(c: CityDbMessage, split: CityDbMessage['splits'][number]): void {
    const state = this.splitStates.get(split.id);
    this.panel.appendChild(h('p', { class: 'citydb-prompt', text: split.intro }));
    split.parts.forEach((p, i) => {
      const done = state?.parts[i]?.status === 'done';
      this.panel.appendChild(
        h(
          'p',
          { class: done ? 'citydb-part done' : 'citydb-part', attrs: { 'data-part': String(i) } },
          h('b', { text: `${done ? '✓ ' : ''}${p.label}` }),
          done && state?.parts[i]?.by ? ` (${state.parts[i]?.by})` : '',
          h('br'),
          p.prompt,
        ),
      );
    });
    if (state?.opened)
      this.panel.appendChild(h('p', { class: 'skills-help', text: this.t('citydb.splitOpened') }));
    const which = h('select', {
      attrs: { 'data-role': 'part-picker', 'aria-label': this.t('citydb.mypart') },
    }) as HTMLSelectElement;
    split.parts.forEach((p, i) => {
      const o = h('option', { text: p.label, attrs: { value: String(i) } }) as HTMLOptionElement;
      o.selected = i === this.part;
      which.appendChild(o);
    });
    which.addEventListener('change', () => (this.part = Number(which.value)));
    this.panel.appendChild(which);
    for (const name of split.tables) {
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
    this.drawEditor();
  }

  private drawEditor(): void {
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
    if (!c || (c.requests.length === 0 && c.splits.length === 0)) {
      this.panel.appendChild(h('p', { class: 'skills-help', text: this.t('citydb.none') }));
      return;
    }
    this.panel.appendChild(h('p', { class: 'skills-help', text: this.t('citydb.help') }));
    // One drop-down, grouped by what the request does, so twenty requests stay tidy.
    const picker = h('select', {
      class: 'citydb-picker',
      attrs: { 'data-role': 'request-picker', 'aria-label': this.t('citydb.pick') },
    }) as HTMLSelectElement;
    for (const kind of ['intel', 'camera', 'door'] as const) {
      const here = c.requests.filter((r) => r.kind === kind);
      if (here.length === 0) continue;
      const group = h('optgroup', {
        attrs: { label: this.t(`citydb.kind.${kind}` as MessageKey) },
      });
      for (const r of here) {
        const option = h('option', {
          text: `${'★'.repeat(r.tier)} ${r.title}`,
          attrs: { value: r.id },
        }) as HTMLOptionElement;
        option.selected = r.id === this.selected;
        group.appendChild(option);
      }
      picker.appendChild(group);
    }
    if (c.splits.length > 0) {
      const group = h('optgroup', { attrs: { label: this.t('citydb.kind.split') } });
      for (const sp of c.splits) {
        const option = h('option', {
          text: `${'★'.repeat(sp.tier)} ${sp.title}`,
          attrs: { value: `split:${sp.id}` },
        }) as HTMLOptionElement;
        option.selected = `split:${sp.id}` === this.selected;
        group.appendChild(option);
      }
      picker.appendChild(group);
    }
    picker.addEventListener('change', () => {
      this.selected = picker.value;
      this.result = undefined;
      this.draw();
    });
    this.panel.appendChild(picker);
    const split = c.splits.find((s) => `split:${s.id}` === this.selected);
    const request = c.requests.find((r) => r.id === this.selected);
    if (!request && !split) return;
    if (split) this.drawSplit(c, split);
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
    this.drawEditor();
  }
}
