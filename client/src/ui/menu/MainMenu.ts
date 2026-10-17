import type { AccountApi, AccountPlayer, WhoAmI } from '../../net/account';
import type { RoomStatus } from '../../net/classRoom';
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
}

const ERRORS: Readonly<Record<string, string>> = {
  cancelled: 'Sign-in was cancelled.',
  domain_not_allowed: 'That Google account is not from an allowed school.',
  email_unverified: 'Google says that email is not verified.',
  bad_token: 'Google’s answer could not be checked. Try again.',
  nonce_mismatch: 'Sign-in could not be verified. Try again.',
  exchange_failed: 'Could not finish signing in with Google. Try again.',
};

/**
 * The first screen: sign in, then play or take the tutorial. A new player
 * reaches a match only through here (a match also requires a ticket).
 */
export class MainMenu {
  readonly root = h('main', { class: 'menu', attrs: { 'data-role': 'menu' } });
  private who: WhoAmI | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: MenuOptions) {}

  /** Asks who is signed in and draws the right screen. */
  async show(parent: HTMLElement = document.body): Promise<void> {
    parent.appendChild(this.root);
    this.draw(undefined);
    this.who = await this.options.account.me();
    this.draw(this.who);
  }

  private draw(who: WhoAmI | undefined): void {
    clear(this.root);
    const card = h('div', { class: 'menu-card' }, h('h1', { text: 'SQL Heist City' }));
    this.root.appendChild(card);
    const error = this.options.signInError;
    if (error)
      card.appendChild(h('p', { class: 'menu-error', text: ERRORS[error] ?? 'Sign-in failed.' }));

    if (!who) {
      card.appendChild(h('p', { class: 'menu-note', text: 'Checking your account…' }));
      return;
    }
    if (who.state === 'signed_in') return this.drawSignedIn(card, who.player);
    card.appendChild(
      h('p', {
        class: 'menu-note',
        text:
          who.state === 'unavailable'
            ? 'The account service is not reachable right now.'
            : 'Sign in with your school Google account to play.',
      }),
    );
    if (who.state === 'signed_out') {
      card.appendChild(
        h('button', {
          class: 'menu-primary',
          text: 'Sign in with Google',
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
          placeholder: 'Test player name',
          'aria-label': 'Test player name',
        },
      });
      card.appendChild(
        h(
          'div',
          { class: 'menu-row' },
          devName,
          h('button', {
            text: 'Dev sign-in',
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
          text: 'Play without signing in (development)',
          on: { click: () => this.options.go('play') },
        }),
      );
      card.appendChild(
        h('button', { text: 'Tutorial', on: { click: () => this.options.go('tutorial') } }),
      );
    }
  }

  /** Shows the waiting room and looks at the class's room until the teacher starts it. */
  private waitForRoom(classId: number, className: string): void {
    clearTimeout(this.timer);
    clear(this.root);
    const status = h('p', { class: 'menu-note', text: 'Waiting for your teacher to start…' });
    this.root.appendChild(
      h(
        'div',
        { class: 'menu-card' },
        h('h1', { text: className }),
        status,
        ...(this.options.goAssess
          ? (['pre', 'post'] as const).map((kind) =>
              h('button', {
                text: kind === 'pre' ? 'Take the pre-test' : 'Take the post-test',
                attrs: { title: 'Only when your teacher has opened it' },
                on: { click: () => this.options.goAssess?.(classId, kind) },
              }),
            )
          : []),
        h('button', {
          class: 'menu-quiet',
          text: 'Leave',
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
        status.textContent = 'Starting…';
        this.options.goClass?.(classId);
        return;
      }
      status.textContent =
        room.state === 'unavailable'
          ? 'Cannot reach the game server. Trying again…'
          : 'Waiting for your teacher to start…';
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
      { attrs: { 'aria-label': 'Year you were born' } },
      h('option', { text: 'Choose a year', attrs: { value: '' } }),
      ...Array.from({ length: 60 }, (_, i) =>
        h('option', { text: String(thisYear - i), attrs: { value: String(thisYear - i) } }),
      ),
    );
    const note = h('p', { class: 'menu-error' });
    card.append(
      h('p', {
        class: 'menu-note',
        text: `Hi ${player.displayName}. Before you play: what year were you born?`,
      }),
      h('p', {
        class: 'menu-muted',
        text: 'This game has cartoon shooting. We only keep whether you are old enough, not your birth year.',
      }),
      h(
        'div',
        { class: 'menu-row' },
        year,
        h('button', {
          class: 'menu-primary',
          text: 'Continue',
          on: {
            click: async () => {
              if (!year.value) {
                note.textContent = 'Choose the year you were born.';
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
        text: 'You are not old enough to play this game yet. Ask your teacher if you think this is a mistake.',
      }),
      h('button', {
        text: 'Delete my account',
        on: {
          click: async () => {
            const sure =
              this.options.confirm?.('Delete your account? This cannot be undone.') ?? true;
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
      text: 'Sign out',
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
        'Signed in as ',
        h('strong', { text: player.displayName }),
        h('span', { class: 'menu-muted', text: ` (${player.email})` }),
      ),
    );
    const nameInput = h('input', {
      attrs: {
        type: 'text',
        maxlength: '20',
        value: player.displayName,
        'aria-label': 'Display name',
      },
    });
    const nameNote = h('span', { class: 'menu-muted' });
    const codeInput = h('input', {
      attrs: {
        type: 'text',
        maxlength: '12',
        placeholder: 'Class code',
        'aria-label': 'Class code',
      },
    });
    const classNote = h('span', { class: 'menu-error' });
    card.append(
      h(
        'div',
        { class: 'menu-row' },
        nameInput,
        h('button', {
          text: 'Save name',
          on: {
            click: async () => {
              const result = await this.options.account.rename(nameInput.value);
              nameNote.textContent = 'error' in result ? result.error : 'Saved';
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
          text: 'Join class',
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
        text: 'Play (open match)',
        on: { click: () => this.options.go('play') },
      }),
      h('button', { text: 'Tutorial', on: { click: () => this.options.go('tutorial') } }),
      h('button', {
        text: 'Practice SQL (solo)',
        attrs: { title: 'Drill a topic on your own: no match, no combat' },
        on: { click: () => this.options.go('practice') },
      }),
      h('button', {
        text: 'Settings',
        attrs: { disabled: '', title: 'Coming with the settings menu' },
      }),
      h('button', {
        class: 'menu-quiet',
        text: 'Download my data',
        on: {
          click: async () => {
            const text = await this.options.account.exportData();
            if (text === undefined) nameNote.textContent = 'Could not get your data';
            else this.options.saveFile?.('my-heist-data.json', text);
          },
        },
      }),
      h('button', {
        class: 'menu-quiet',
        text: 'Delete my account',
        on: {
          click: async () => {
            const sure = this.options.confirm?.(
              'Delete your account and everything stored about you? This cannot be undone.',
            );
            if (!sure) return;
            if (await this.options.account.deleteAccount()) {
              this.who = { state: 'signed_out' };
              this.draw(this.who);
            } else nameNote.textContent = 'Could not delete the account';
          },
        },
      }),
      h('button', {
        class: 'menu-quiet',
        text: 'Sign out',
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
