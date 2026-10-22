import {
  COSMETIC_SLOTS,
  type CosmeticView,
  type SeasonMessage,
  type WardrobeMessage,
} from '@heist/shared';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';
import './skills.css';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * The wardrobe (Phase 26.3): what a student has earned to wear, and what is still locked and why.
 * Choosing sends a request; the server checks it and answers with the new wardrobe.
 */
export class WardrobeView {
  readonly root = h('section', {
    class: 'skills wardrobe',
    attrs: { 'data-role': 'wardrobe', role: 'dialog', hidden: '' },
  });
  private last: WardrobeMessage | undefined;
  private season: SeasonMessage['season'];

  constructor(
    private readonly i18n: I18n,
    private readonly choose: (slot: CosmeticView['slot'], id: string | null) => void,
  ) {
    i18n.onChange(() => this.draw());
    this.draw();
  }

  get hidden(): boolean {
    return Boolean(this.root.hidden);
  }

  set hidden(value: boolean) {
    this.root.hidden = value;
  }

  update(message: WardrobeMessage): void {
    this.last = message;
    this.draw();
  }

  /** The current season's track, shown with the wardrobe it fills. */
  updateSeason(message: SeasonMessage): void {
    this.season = message.season;
    this.draw();
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  private draw(): void {
    clear(this.root);
    this.root.setAttribute('aria-label', this.t('wardrobe.title'));
    const items = this.last?.items ?? [];
    this.root.append(
      h(
        'header',
        { class: 'skills-head' },
        h('h2', { text: this.t('wardrobe.title') }),
        h('button', { text: this.t('wardrobe.close'), on: { click: () => (this.hidden = true) } }),
      ),
      h('p', { class: 'skills-help', text: this.t('wardrobe.help') }),
      ...this.seasonSection(),
      ...COSMETIC_SLOTS.map((slot) => {
        const worn = this.last?.choice[slot];
        return h(
          'div',
          { class: 'wardrobe-slot', attrs: { 'data-slot': slot } },
          h('h3', { text: this.t(`wardrobe.slot.${slot}` as MessageKey) }),
          h(
            'ul',
            { class: 'skills-row' },
            ...items.filter((i) => i.slot === slot).map((i) => this.item(i, worn === i.id)),
            worn
              ? h(
                  'li',
                  { class: 'skills-node' },
                  h('button', {
                    text: this.t('wardrobe.takeOff'),
                    on: { click: () => this.choose(slot, null) },
                  }),
                )
              : null,
          ),
        );
      }),
    );
  }

  /** The season's free track: where the student is, and what each step gives. */
  private seasonSection(): HTMLElement[] {
    const s = this.season;
    if (!s) return [];
    return [
      h(
        'div',
        { class: 'season', attrs: { 'data-role': 'season' } },
        h('h3', { text: this.t('season.title', { name: s.name }) }),
        h('p', { class: 'skills-help', text: this.t('season.help') }),
        h('p', {
          class: 'skills-help',
          text: `${this.t('season.level', { level: s.level, total: s.track.length, xp: s.xp })} · ${
            s.active ? this.t('season.daysLeft', { days: s.daysLeft }) : this.t('season.ended')
          }`,
        }),
        h(
          'ol',
          { class: 'season-track' },
          ...s.track.map((step) =>
            h(
              'li',
              { attrs: { 'data-unlocked': String(step.unlocked) } },
              `${this.t('season.step', { xp: step.xp, name: step.cosmeticName })} — `,
              h('strong', { text: this.t(step.unlocked ? 'season.unlocked' : 'season.locked') }),
            ),
          ),
        ),
      ),
    ];
  }

  private item(i: CosmeticView, worn: boolean): HTMLElement {
    const need = i.needs
      ? [
          i.needs.rank ? this.t('wardrobe.needRank', { rank: i.needs.rank }) : '',
          i.needs.skill ? this.t('wardrobe.needSkill', { skill: i.needs.skill }) : '',
          i.needs.season
            ? this.t('wardrobe.needSeason', { xp: i.needs.season.xp, season: i.needs.season.name })
            : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : '';
    const swatch = h('span', { class: 'wardrobe-swatch', attrs: { 'aria-hidden': 'true' } });
    swatch.style.background = hex(i.color);
    return h(
      'li',
      {
        class: `skills-node ${i.unlocked ? (worn ? 'skills-mastered' : 'skills-open') : 'skills-locked'}`,
        attrs: { 'data-cosmetic': i.id, 'data-unlocked': String(i.unlocked) },
      },
      h('div', { class: 'skills-name' }, swatch, ` ${i.name}`),
      i.unlocked
        ? h('button', {
            text: worn ? this.t('wardrobe.worn') : this.t('wardrobe.wear'),
            attrs: { 'aria-pressed': String(worn) },
            on: { click: () => !worn && this.choose(i.slot, i.id) },
          })
        : h('div', { class: 'skills-needs', text: `🔒 ${need}` }),
    );
  }
}
