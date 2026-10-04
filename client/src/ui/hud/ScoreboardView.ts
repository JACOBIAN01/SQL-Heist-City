import type { StandingView } from '@heist/shared';
import { h } from '../dom';
import { formatMoney } from './Hud';

/** What the round logic may ask of the scoreboard UI (an interface so logic is tested without a DOM). */
export interface RoundView {
  setTimer(text: string | undefined): void;
  setScores(top: readonly StandingView[], players: number): void;
  setStanding(rank: number, players: number): void;
  setBoardVisible(visible: boolean): void;
  showResults(winner: StandingView | null, standings: readonly StandingView[]): void;
  setNextIn(seconds: number): void;
  hideResults(): void;
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
  private top: readonly StandingView[] = [];

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
    this.results = h(
      'div',
      { class: 'hud-results' },
      h('h1', { text: 'ROUND OVER' }),
      this.resultsBody,
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

  setScores(top: readonly StandingView[], players: number): void {
    this.top = top;
    this.boardBody.replaceChildren(table(top, this.myId()));
    this.board.dataset.players = String(players);
  }

  setStanding(rank: number, players: number): void {
    this.standing.textContent = `You: #${rank} of ${players}`;
  }

  setBoardVisible(visible: boolean): void {
    this.board.hidden = !visible;
    // The "you" highlight needs our id, which is only known after the welcome.
    if (visible) this.boardBody.replaceChildren(table(this.top, this.myId()));
  }

  showResults(winner: StandingView | null, standings: readonly StandingView[]): void {
    this.resultsBody.replaceChildren(
      h('div', {
        class: 'hud-winner',
        text: winner
          ? `${winner.name} wins with ${formatMoney(winner.banked)}`
          : 'Nobody banked any cash',
      }),
      table(standings, this.myId()),
    );
    this.results.hidden = false;
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
