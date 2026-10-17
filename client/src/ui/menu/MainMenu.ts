import type { AccountApi, AccountPlayer, WhoAmI } from '../../net/account';
import type { RoomStatus } from '../../net/classRoom';
import { defaultI18n, type I18n } from '../../i18n/I18n';
import type { MessageKey } from '../../i18n/en';
import { clear, h } from '../dom';
import './menu.css';

export interface MenuOptions {
  readonly account: AccountApi;
  /** Go to a place in the game ('play' or 'tutorial'). */
  readonly go: (destination: 'play' | 'tutorial' | 'practice') => void;
  /** Send the browser away (to Google). */
  readonly navigate: (url: string) => void;
  /** Where Google should send the player back to. */
  readonly returnTo: string;
  /** Where a class's room stands (not started, or live). */
  readonly roomStatus?: (classId: number) => Promise<RoomStatus>;
  /** Take the class's pre- or post-test (Phase 16.10). */
  readonly goAssess?: (classId: number, kind: 'pre' | 'post') => void;
  /** Enter a class's live room. */
  readonly goClass?: (classId: number) => void;
  /** Milliseconds between looks at the room while waiting (default 2000). */
  readonly pollMs?: number;
  /** Asked before an account is deleted. */
  readonly confirm?: (message: string) => boolean;
  /** Offers a file to the user. */
  readonly saveFile?: (name: string, text: string) => void;
  /** Development builds can play without signing in. */
  readonly allowUnsigned: boolean;
  /** Development: sign in as a made-up player (needs DEV_LOGIN=1 on the account service). */
  readonly devSignInUrl?: (name: string, returnTo: string) => string;
  /** Why the last sign-in failed (`?signin_error=`), if it did. */
  readonly signInError?: string | null;
  /** Interface language; English when absent. */
  readonly i18n?: I18n;
  /** Opens the settings panel (Phase 22); the button stays off without it. */
  readonly openSettings?: () => void;
}

const ERRORS: Readonly<Record<string, MessageKey>> = {
  cancelled: 'signin.cancelled',
  domain_not_allowed: 'signin.domain_not_allowed',
  email_unverified: 'signin.email_unverified',
  bad_token: 'signin.bad_token',
  nonce_mismatch: 'signin.nonce_mismatch',
  exchange_failed: 'signin.exchange_failed',
};

/**
 * The first screen: sign in, then play or take the tutorial. A new player
 * reaches a match only through here (a match also requires a ticket).
 */
export class MainMenu {
  readonly root = h('main', { class: 'menu', attrs: { 'data-role': 'menu' } });
  private who: WhoAmI | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly i18n: I18n;

  constructor(private readonly options: MenuOptions) {
    this.i18n = options.i18n ?? defaultI18n;
    // A language picked while the menu is open redraws it in the new language.
    this.i18n.onChange(() => {
      if (this.root.isConnected && !this.timer) this.draw(this.who);
    });
  }

  private t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  /** Asks who is signed in and draws the right screen. */
  async show(parent: HTMLElement = document.body): Promise<void> {
    parent.appendChild(this.root);
    this.draw(undefined);
    this.who = await this.options.account.me();
    this.draw(this.who);
  }

  private draw(who: WhoAmI | undefined): void {
    this.drawScreen(who);
    // Every screen links the policies (Phase 21.2).
    this.root
      .querySelector('.menu-card')
      ?.appendChild(
        h(
          'p',
          { class: 'menu-muted menu-legal' },
          h('a', { text: this.t('legal.privacy'), attrs: { href: '/legal/privacy.html' } }),
          ' · ',
          h('a', { text: this.t('legal.terms'), attrs: { href: '/legal/terms.html' } }),
        ),
      );
  }

  private drawScreen(who: WhoAmI | undefined): void {
    clear(this.root);
    const card = h('div', { class: 'menu-card' }, h('h1', { text: 'SQL Heist City' }));
    this.root.appendChild(card);
    const error = this.options.signInError;
    if (error)
      card.appendChild(
        h('p', { class: 'menu-error', text: this.t(ERRORS[error] ?? 'signin.failed') }),
      );

    if (!who) {
      card.appendChild(h('p', { class: 'menu-note', text: this.t('menu.checking') }));
      return;
    }
    if (who.state === 'signed_in') return this.drawSignedIn(card, who.player);
    card.appendChild(
      h('p', {
        class: 'menu-note',
        text:
          who.state === 'unavailable' ? this.t('menu.unreachable') : this.t('menu.signInPrompt'),
      }),
    );
    if (who.state === 'signed_out') {
      card.appendChild(
        h('button', {
          class: 'menu-primary',
          text: this.t('menu.signIn'),
          on: {
            click: () =>
              this.options.navigate(this.options.account.signInUrl(this.options.returnTo)),
          },
        }),
      );
    }
    if (who.state === 'signed_out' && this.options.devSignInUrl) {
      const devName = h('input', {
        attrs: {
          type: 'text',
          maxlength: '20',
          placeholder: this.t('menu.devPlaceholder'),
          'aria-label': this.t('menu.devPlaceholder'),
        },
      });
      card.appendChild(
        h(
          'div',
          { class: 'menu-row' },
          devName,
          h('button', {
            text: this.t('menu.devSignIn'),
            on: {
              click: () =>
                devName.value.trim() &&
                this.options.navigate(
                  (this.options.devSignInUrl as NonNullable<MenuOptions['devSignInUrl']>)(
                    devName.value.trim(),
                    this.options.returnTo,
                  ),
                ),
            },
          }),
        ),
      );
    }
    if (this.options.allowUnsigned) {
      card.appendChild(
        h('button', {
          text: this.t('menu.playUnsigned'),
          on: { click: () => this.options.go('play') },
        }),
      );
      card.appendChild(
        h('button', {
          text: this.t('menu.tutorial'),
          on: { click: () => this.options.go('tutorial') },
        }),
      );
    }
  }

  /** Shows the waiting room and looks at the class's room until the teacher starts it. */
  private waitForRoom(classId: number, className: string): void {
    clearTimeout(this.timer);
    clear(this.root);
    const status = h('p', { class: 'menu-note', text: this.t('menu.waiting') });
    this.root.appendChild(
      h(
        'div',
        { class: 'menu-card' },
        h('h1', { text: className }),
        status,
        ...(this.options.goAssess
          ? (['pre', 'post'] as const).map((kind) =>
              h('button', {
                text: kind === 'pre' ? this.t('menu.preTest') : this.t('menu.postTest'),
                attrs: { title: this.t('menu.testHint') },
                on: { click: () => this.options.goAssess?.(classId, kind) },
              }),
            )
          : []),
        h('button', {
          class: 'menu-quiet',
          text: this.t('menu.leave'),
          on: {
            click: () => {
              clearTimeout(this.timer);
              if (this.who) this.draw(this.who);
            },
          },
        }),
      ),
    );
    const look = async () => {
      const room = (await this.options.roomStatus?.(classId)) ?? { state: 'unavailable' as const };
      if (room.state === 'live') {
        status.textContent = this.t('menu.starting');
        this.options.goClass?.(classId);
        return;
      }
      status.textContent =
        room.state === 'unavailable' ? this.t('menu.noServer') : this.t('menu.waiting');
      this.timer = setTimeout(() => void look(), this.options.pollMs ?? 2000);
    };
    void look();
  }

  /**
   * The age gate (Phase 21.7): asked once, before anything else. The year is sent to the account
   * service, which keeps only whether it was old enough.
   */
  private drawAgeGate(card: HTMLElement, player: AccountPlayer): void {
    const thisYear = new Date().getFullYear();
    const year = h(
      'select',
      { attrs: { 'aria-label': this.t('age.yearLabel') } },
      h('option', { text: this.t('age.choose'), attrs: { value: '' } }),
      ...Array.from({ length: 60 }, (_, i) =>
        h('option', { text: String(thisYear - i), attrs: { value: String(thisYear - i) } }),
      ),
    );
    const note = h('p', { class: 'menu-error' });
    card.append(
      h('p', {
        class: 'menu-note',
        text: this.t('age.hello', { name: player.displayName }),
      }),
      h('p', {
        class: 'menu-muted',
        text: this.t('age.note'),
      }),
      h(
        'div',
        { class: 'menu-row' },
        year,
        h('button', {
          class: 'menu-primary',
          text: this.t('age.continue'),
          on: {
            click: async () => {
              if (!year.value) {
                note.textContent = this.t('age.chooseError');
                return;
              }
              const result = await this.options.account.declareAge(Number(year.value));
              if ('error' in result) {
                note.textContent = result.error;
                if (result.tooYoung)
                  this.who = { state: 'signed_in', player: { ...player, ageStatus: 'too_young' } };
              } else this.who = { state: 'signed_in', player: result };
              this.draw(this.who);
            },
          },
        }),
      ),
      note,
      this.signOutButton(),
    );
  }

  /** Someone the age gate turned away: no way into the game, but a way out of the account. */
  private drawTooYoung(card: HTMLElement): void {
    card.append(
      h('p', {
        class: 'menu-error',
        text: this.t('age.tooYoung'),
      }),
      h('button', {
        text: this.t('menu.deleteAccount'),
        on: {
          click: async () => {
            const sure = this.options.confirm?.(this.t('age.deleteConfirm')) ?? true;
            if (sure && (await this.options.account.deleteAccount())) {
              this.who = { state: 'signed_out' };
              this.draw(this.who);
            }
          },
        },
      }),
      this.signOutButton(),
    );
  }

  private signOutButton(): HTMLElement {
    return h('button', {
      text: this.t('menu.signOut'),
      on: {
        click: async () => {
          await this.options.account.signOut();
          this.who = { state: 'signed_out' };
          this.draw(this.who);
        },
      },
    });
  }

  private drawSignedIn(card: HTMLElement, player: AccountPlayer): void {
    if (player.ageStatus === 'unknown') return this.drawAgeGate(card, player);
    if (player.ageStatus === 'too_young') return this.drawTooYoung(card);
    card.appendChild(
      h(
        'p',
        { class: 'menu-who' },
        `${this.t('menu.signedInAs')} `,
        h('strong', { text: player.displayName }),
        h('span', { class: 'menu-muted', text: ` (${player.email})` }),
      ),
    );
    const nameInput = h('input', {
      attrs: {
        type: 'text',
        maxlength: '20',
        value: player.displayName,
        'aria-label': this.t('menu.displayName'),
      },
    });
    const nameNote = h('span', { class: 'menu-muted' });
    const codeInput = h('input', {
      attrs: {
        type: 'text',
        maxlength: '12',
        placeholder: this.t('menu.classCode'),
        'aria-label': this.t('menu.classCode'),
      },
    });
    const classNote = h('span', { class: 'menu-error' });
    card.append(
      h(
        'div',
        { class: 'menu-row' },
        nameInput,
        h('button', {
          text: this.t('menu.saveName'),
          on: {
            click: async () => {
              const result = await this.options.account.rename(nameInput.value);
              nameNote.textContent = 'error' in result ? result.error : this.t('menu.saved');
              if (!('error' in result)) nameInput.value = result.displayName;
            },
          },
        }),
      ),
      nameNote,
      h(
        'div',
        { class: 'menu-row' },
        codeInput,
        h('button', {
          class: 'menu-primary',
          text: this.t('menu.joinClass'),
          on: {
            click: async () => {
              classNote.textContent = '';
              const joined = await this.options.account.joinClass(codeInput.value);
              if ('error' in joined) classNote.textContent = joined.error;
              else this.waitForRoom(joined.id, joined.name);
            },
          },
        }),
      ),
      classNote,
      h('button', {
        text: this.t('menu.playOpen'),
        on: { click: () => this.options.go('play') },
      }),
      h('button', {
        text: this.t('menu.tutorial'),
        on: { click: () => this.options.go('tutorial') },
      }),
      h('button', {
        text: this.t('menu.practice'),
        attrs: { title: this.t('menu.practiceHint') },
        on: { click: () => this.options.go('practice') },
      }),
      h('button', {
        text: this.t('menu.settings'),
        ...(this.options.openSettings
          ? { on: { click: () => this.options.openSettings?.() } }
          : { attrs: { disabled: '' } }),
      }),
      h('button', {
        class: 'menu-quiet',
        text: this.t('menu.downloadData'),
        on: {
          click: async () => {
            const text = await this.options.account.exportData();
            if (text === undefined) nameNote.textContent = this.t('menu.noData');
            else this.options.saveFile?.('my-heist-data.json', text);
          },
        },
      }),
      h('button', {
        class: 'menu-quiet',
        text: this.t('menu.deleteAccount'),
        on: {
          click: async () => {
            const sure = this.options.confirm?.(this.t('menu.deleteConfirm'));
            if (!sure) return;
            if (await this.options.account.deleteAccount()) {
              this.who = { state: 'signed_out' };
              this.draw(this.who);
            } else nameNote.textContent = this.t('menu.deleteFailed');
          },
        },
      }),
      h('button', {
        class: 'menu-quiet',
        text: this.t('menu.signOut'),
        on: {
          click: async () => {
            await this.options.account.signOut();
            this.who = { state: 'signed_out' };
            this.draw(this.who);
          },
        },
      }),
    );
  }
}
