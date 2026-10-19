import type { SkillView } from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';
import './skills.css';

const STATE_KEY: Record<SkillView['state'], MessageKey> = {
  locked: 'skills.locked',
  open: 'skills.open',
  mastered: 'skills.mastered',
};
const MARK: Record<SkillView['state'], string> = { locked: '🔒', open: '◯', mastered: '✔' };

/**
 * The skill tree (Phase 26.2): topics in rows by how far into SQL they are, each showing whether
 * it is locked, open or mastered (by a word and a mark, never by colour alone) and how far the
 * student has got. Mastery decides what opens; nothing here changes play.
 */
export class SkillTreeView {
  readonly root = h('section', {
    class: 'skills',
    attrs: { 'data-role': 'skills', role: 'dialog', hidden: '' },
  });
  private views: readonly SkillView[] = [];

  constructor(
    private readonly i18n: I18n,
    private readonly onClose: () => void = () => {},
  ) {
    i18n.onChange(() => this.draw());
    this.draw();
  }

  get hidden(): boolean {
    return Boolean(this.root.hidden);
  }

  set hidden(value: boolean) {
    this.root.hidden = value;
    if (value) this.onClose();
  }

  update(skills: readonly SkillView[]): void {
    this.views = skills;
    this.draw();
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  private draw(): void {
    clear(this.root);
    this.root.setAttribute('aria-label', this.t('skills.title'));
    const rows = new Map<number, SkillView[]>();
    for (const v of this.views) rows.set(v.depth, [...(rows.get(v.depth) ?? []), v]);
    const names = new Map(this.views.map((v) => [v.id, v.name]));
    this.root.append(
      h(
        'header',
        { class: 'skills-head' },
        h('h2', { text: this.t('skills.title') }),
        h('button', {
          text: this.t('skills.close'),
          on: { click: () => (this.hidden = true) },
        }),
      ),
      h('p', { class: 'skills-help', text: this.t('skills.help') }),
      ...[...rows.keys()]
        .sort((a, b) => a - b)
        .map((depth) =>
          h(
            'ul',
            { class: 'skills-row', attrs: { 'aria-label': `${depth + 1}` } },
            ...(rows.get(depth) ?? []).map((v) => this.node(v, names)),
          ),
        ),
    );
  }

  private node(v: SkillView, names: ReadonlyMap<string, string>): HTMLElement {
    const percent = v.progress === null ? null : Math.round(v.progress * 100);
    return h(
      'li',
      {
        class: `skills-node skills-${v.state}`,
        attrs: { 'data-skill': v.id, 'data-state': v.state },
      },
      h('div', { class: 'skills-name', text: `${MARK[v.state]} ${v.name}` }),
      h('div', { class: 'skills-state', text: this.t(STATE_KEY[v.state]) }),
      h('div', {
        class: 'skills-progress',
        text:
          percent === null
            ? this.t('skills.none')
            : this.t('skills.progress', { percent, items: v.items }),
      }),
      v.state === 'locked'
        ? h('div', {
            class: 'skills-needs',
            text: this.t('skills.needs', {
              names: v.requires.map((r) => names.get(r) ?? r).join(', '),
            }),
          })
        : null,
    );
  }
}
