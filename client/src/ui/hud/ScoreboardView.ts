import {
  AWARDS,
  SQUAD_AWARDS,
  type AwardUnit,
  type AwardView,
  type SquadAwardView,
  type SquadStandingView,
  type StandingView,
} from '@heist/shared';
import { h } from '../dom';
import { formatMoney } from './Hud';

/** What the round logic may ask of the scoreboard UI (an interface so logic is tested without a DOM). */
export interface RoundView {
  setTimer(text: string | undefined): void;
  setScores(
    top: readonly StandingView[],
    players: number,
    squads?: readonly SquadStandingView[],
  ): void;
  setStanding(rank: number, players: number): void;
  setBoardVisible(visible: boolean): void;
  showResults(
    winner: StandingView | null,
    standings: readonly StandingView[],
    awards: readonly AwardView[],
    squads?: readonly SquadStandingView[],
    squadAwards?: readonly SquadAwardView[],
  ): void;
  setNextIn(seconds: number): void;
  hideResults(): void;
}

/** An award's number as it reads: $12,000 · 3 · 18.5 s. */
export function formatAward(value: number, unit: AwardUnit): string {
  if (unit === 'money') return formatMoney(value);
  if (unit === 'seconds') return `${value.toFixed(1)} s`;
  return String(value);
}

/** The round's awards as a row of cards: title, who, and the number that won it. */
function awardCards(awards: readonly AwardView[], myId: number | undefined): HTMLElement {
  return h(
    'div',
    { class: 'hud-awards' },
    ...awards.map((a) => {
      const info = AWARDS[a.id];
      return h(
        'div',
        { class: a.playerId === myId ? 'hud-award me' : 'hud-award' },
        h('div', { class: 'hud-award-title', text: info.title }),
        h('div', {
          class: 'hud-award-name',
          text: a.playerId === myId ? `${a.name} (you)` : a.name,
        }),
        h('div', { class: 'hud-award-value', text: formatAward(a.value, info.unit) }),
        h('div', { class: 'hud-award-for', text: info.for }),
      );
    }),
  );
}

/** The squads' table: each squad's cash, kills, locks and solved tasks added up (Phase 27.5). */
export function squadTable(
  rows: readonly SquadStandingView[],
  mySquad: number | undefined,
): HTMLElement {
  return h(
    'table',
    { class: 'hud-table hud-squads', attrs: { 'aria-label': 'Squad scores' } },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { text: '#' }),
        h('th', { text: 'Squad' }),
        h('th', { text: 'Banked' }),
        h('th', { text: 'Kills' }),
        h('th', { text: 'Locks' }),
        h('th', { text: 'Solved' }),
      ),
    ),
    h(
      'tbody',
      {},
      ...rows.map((r, i) =>
        h(
          'tr',
          { class: r.squad === mySquad ? 'me' : '' },
          h('td', { text: String(i + 1) }),
          h('td', { text: `${r.name} (${r.members})` }),
          h('td', { text: formatMoney(r.banked) }),
          h('td', { text: String(r.kills) }),
          h('td', { text: String(r.locks) }),
          h('td', { text: String(r.solves) }),
        ),
      ),
    ),
  );
}

/** The squads' awards as cards, like the players' ones. */
function squadAwardCards(
  awards: readonly SquadAwardView[],
  mySquad: number | undefined,
): HTMLElement {
  return h(
    'div',
    { class: 'hud-awards hud-squad-awards' },
    ...awards.map((a) => {
      const info = SQUAD_AWARDS[a.id];
      return h(
        'div',
        { class: a.squad === mySquad ? 'hud-award me' : 'hud-award' },
        h('div', { class: 'hud-award-title', text: info.title }),
        h('div', {
          class: 'hud-award-name',
          text: a.squad === mySquad ? `${a.name} (your squad)` : a.name,
        }),
        h('div', { class: 'hud-award-value', text: formatAward(a.value, info.unit) }),
        h('div', { class: 'hud-award-for', text: info.for }),
      );
    }),
  );
}

function table(rows: readonly StandingView[], myId: number | undefined): HTMLElement {
  return h(
    'table',
    { class: 'hud-table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { text: '#' }),
        h('th', { text: 'Player' }),
        h('th', { text: 'Banked' }),
        h('th', { text: 'Kills' }),
      ),
    ),
    h(
      'tbody',
      {},
      ...rows.map((r, i) =>
        h(
          'tr',
          { class: r.id === myId ? 'me' : '' },
          h('td', { text: String(i + 1) }),
          h('td', { text: r.name }),
          h('td', { text: formatMoney(r.banked) }),
          h('td', { text: String(r.kills) }),
        ),
      ),
    ),
  );
}

/** Round timer, the hold-to-show scoreboard and the end-of-round results card. Text only, never HTML. */
export class ScoreboardView implements RoundView {
  readonly root: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly board: HTMLElement;
  private readonly boardBody: HTMLElement;
  private readonly standing: HTMLElement;
  private readonly results: HTMLElement;
  private readonly resultsBody: HTMLElement;
  private readonly nextIn: HTMLElement;
  private readonly action: HTMLElement;
  private top: readonly StandingView[] = [];
  private squads: readonly SquadStandingView[] = [];
  /** The squad this player is in (0 none); set by the squad messages. */
  mySquad = 0;

  constructor(
    host: HTMLElement,
    private readonly myId: () => number | undefined = () => undefined,
  ) {
    this.timer = h('div', { class: 'hud-timer' });
    this.timer.hidden = true;
    this.boardBody = h('div');
    this.standing = h('div', { class: 'hud-standing' });
    this.board = h(
      'div',
      { class: 'hud-board' },
      h('h2', { text: 'Scoreboard' }),
      this.boardBody,
      this.standing,
    );
    this.board.hidden = true;
    this.resultsBody = h('div');
    this.nextIn = h('div', { class: 'hud-next' });
    this.action = h('div', { class: 'hud-results-action' });
    this.results = h(
      'div',
      { class: 'hud-results' },
      h('h1', { text: 'ROUND OVER' }),
      this.resultsBody,
      this.action,
      this.nextIn,
    );
    this.results.hidden = true;
    this.root = h('div', { class: 'hud hud-round' }, this.timer, this.board, this.results);
    host.append(this.root);
  }

  setTimer(text: string | undefined): void {
    this.timer.hidden = text === undefined;
    this.timer.textContent = text ?? '';
  }

  setScores(
    top: readonly StandingView[],
    players: number,
    squads: readonly SquadStandingView[] = [],
  ): void {
    this.top = top;
    this.squads = squads;
    this.boardBody.replaceChildren(
      table(top, this.myId()),
      ...(squads.length ? [squadTable(squads, this.mySquad)] : []),
    );
    this.board.dataset.players = String(players);
  }

  setStanding(rank: number, players: number): void {
    this.standing.textContent = `You: #${rank} of ${players}`;
  }

  setBoardVisible(visible: boolean): void {
    this.board.hidden = !visible;
    // The "you" highlight needs our id, which is only known after the welcome.
    if (visible)
      this.boardBody.replaceChildren(
        table(this.top, this.myId()),
        ...(this.squads.length ? [squadTable(this.squads, this.mySquad)] : []),
      );
  }

  showResults(
    winner: StandingView | null,
    standings: readonly StandingView[],
    awards: readonly AwardView[] = [],
    squads: readonly SquadStandingView[] = [],
    squadAwards: readonly SquadAwardView[] = [],
  ): void {
    this.resultsBody.replaceChildren(
      h('div', {
        class: 'hud-winner',
        text: winner
          ? `${winner.name} wins with ${formatMoney(winner.banked)}`
          : 'Nobody banked any cash',
      }),
      ...(awards.length > 0 ? [awardCards(awards, this.myId())] : []),
      table(standings, this.myId()),
      ...(squads.length > 0 ? [h('h2', { text: 'Squads' }), squadTable(squads, this.mySquad)] : []),
      ...(squadAwards.length > 0 ? [squadAwardCards(squadAwards, this.mySquad)] : []),
    );
    this.results.hidden = false;
  }

  /**
   * A button under the results (planning the next heist), or none. The card is otherwise
   * click-through; only this button takes the pointer.
   */
  setAction(label: string | null, onClick?: () => void): void {
    this.action.replaceChildren(
      ...(label === null
        ? []
        : [
            h('button', {
              class: 'hud-action-btn',
              text: label,
              attrs: { type: 'button' },
              on: { click: () => onClick?.() },
            }),
          ]),
    );
  }

  setNextIn(seconds: number): void {
    this.nextIn.textContent = `Next round in ${Math.max(0, Math.ceil(seconds))} s`;
  }

  hideResults(): void {
    this.results.hidden = true;
  }

  destroy(): void {
    this.root.remove();
  }
}
