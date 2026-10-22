import type { PlayerProfilePage, ProfileMessage } from '@heist/shared';
import type { AccountApi } from '../../net/account';
import type { I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';
import { ProfileView } from '../profile/ProfileView';
import '../profile/skills.css';

/**
 * The student's own profile page (Phase 26.9), opened from the menu: rank and XP, the radars of
 * what they have mastered, topics mastered, recent rounds and what they wear. Everything comes
 * from the account service's records; nothing is made up for the page.
 */
export class ProfilePage {
  readonly root = h('section', {
    class: 'skills profile-page',
    attrs: { 'data-role': 'profile-page', role: 'dialog', hidden: '' },
  });
  private data: PlayerProfilePage | 'loading' | 'failed' = 'loading';
  private readonly radars = new ProfileView('all');

  constructor(
    private readonly account: Pick<AccountApi, 'loadProfile'>,
    private readonly i18n: I18n,
  ) {
    i18n.onChange(() => this.draw());
    this.draw();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  async open(parent: HTMLElement = document.body): Promise<void> {
    if (!this.root.isConnected) parent.appendChild(this.root);
    this.root.hidden = false;
    this.data = 'loading';
    this.draw();
    this.data = (await this.account.loadProfile()) ?? 'failed';
    this.draw();
  }

  close(): void {
    this.root.hidden = true;
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  private draw(): void {
    clear(this.root);
    this.root.setAttribute('aria-label', this.t('profilePage.title'));
    this.root.appendChild(
      h(
        'header',
        { class: 'skills-head' },
        h('h2', { text: this.t('profilePage.title') }),
        h('button', { text: this.t('profilePage.close'), on: { click: () => this.close() } }),
      ),
    );
    if (this.data === 'loading' || this.data === 'failed') {
      this.root.appendChild(
        h('p', {
          class: 'skills-help',
          text: this.t(this.data === 'loading' ? 'profilePage.loading' : 'profilePage.unavailable'),
          attrs: { role: 'status' },
        }),
      );
      return;
    }
    const p = this.data;
    const pr = p.progress;
    const share = pr.span > 0 ? Math.min(1, pr.into / pr.span) : 1;
    const bar = h(
      'div',
      {
        class: 'hud-rank-bar',
        attrs: {
          role: 'progressbar',
          'aria-label': 'XP',
          'aria-valuemin': '0',
          'aria-valuemax': String(pr.span || 1),
          'aria-valuenow': String(pr.span ? pr.into : 1),
        },
      },
      h('div', { class: 'hud-rank-fill' }),
    );
    (bar.firstElementChild as HTMLElement).style.width = `${Math.round(share * 100)}%`;

    const mastered = p.skills.filter((s) => s.state === 'mastered');
    const worn = p.wardrobe.items.filter((i) => p.wardrobe.choice[i.slot] === i.id);
    const unlocked = p.wardrobe.items.filter((i) => i.unlocked).length;
    this.radars.update({
      t: 'profile',
      all: { rcsbe: p.mastery.rcsbe, bloom: p.mastery.bloom },
    } as ProfileMessage);

    this.root.append(
      h('h3', { text: p.name }),
      h('p', {
        class: 'profile-rank',
        text: this.t('profilePage.rank', { rank: pr.rank, xp: pr.xp }),
      }),
      bar,
      h('p', {
        class: 'skills-help',
        text: pr.nextRank
          ? this.t('profilePage.next', { xp: pr.span - pr.into, next: pr.nextRank })
          : this.t('profilePage.topRank'),
      }),
      h('p', {
        class: 'skills-help',
        text: this.t('profilePage.split', { learning: pr.learningXp, play: pr.playXp }),
      }),
      h('p', { class: 'skills-help', text: this.t('profilePage.streak', { days: p.streakDays }) }),

      h('h3', { text: this.t('profilePage.mastery') }),
      this.radars.root,
      h('p', {
        class: 'skills-help',
        text: this.t('profilePage.skills', { done: mastered.length, total: p.skills.length }),
      }),
      mastered.length
        ? h('ul', { class: 'profile-mastered' }, ...mastered.map((s) => h('li', { text: s.name })))
        : h('p', { class: 'skills-help', text: this.t('profilePage.noSkills') }),

      h('h3', { text: this.t('profilePage.history') }),
      p.history.length
        ? h(
            'ul',
            { class: 'profile-history' },
            ...p.history.map((r) =>
              h('li', {
                text: [
                  this.t('profilePage.round', { round: r.round }),
                  this.t('profilePage.place', { rank: r.rank, players: r.players }),
                  this.t('profilePage.haul', { money: `$${r.banked.toLocaleString('en-US')}` }),
                  this.t('profilePage.kills', { kills: r.kills }),
                  new Date(r.endedAt).toLocaleDateString(),
                ].join(' · '),
              }),
            ),
          )
        : h('p', { class: 'skills-help', text: this.t('profilePage.noHistory') }),

      h('h3', { text: this.t('profilePage.wardrobe') }),
      h('p', {
        class: 'skills-help',
        text: this.t('profilePage.unlocked', { done: unlocked, total: p.wardrobe.items.length }),
      }),
      h('p', {
        class: 'skills-help',
        text: worn.length
          ? this.t('profilePage.wearing', { names: worn.map((i) => i.name).join(', ') })
          : this.t('profilePage.nothingWorn'),
      }),
    );
  }
}
