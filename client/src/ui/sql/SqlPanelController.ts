import type { HintReveal, PublicChallenge, RunResult, SubmitResult } from '@heist/shared';
import { ChallengeConnectionError, type ChallengeApi } from '../../net/ChallengeApi';
import { h } from '../dom';
import { hintCostText, rewardLabel } from './labels';
import { CONNECTION_MESSAGE, hintFailureMessage, reasonMessage } from './messages';
import { ProblemPane } from './ProblemPane';
import type { SqlPanel } from './SqlPanel';
import { WorkPane } from './WorkPane';

export interface SolvedInfo {
  readonly rewardKey: string;
  readonly target: string | null;
}

export interface SqlPanelControllerDeps {
  readonly panel: SqlPanel;
  readonly api: ChallengeApi;
  /** The server accepted the answer; the game applies the reward it announces. */
  readonly onSolved?: (info: SolvedInfo) => void;
  /** A hint was revealed for the first time; the game deducts its cost (once). */
  readonly onHintCharged?: (hint: HintReveal) => void;
}

// Pattern: Facade — Why: the game talks to one object ("start a task") while
// the panel's pieces (problem pane, editor, results, network) stay hidden and
// individually testable behind it.
export class SqlPanelController {
  private readonly problem: ProblemPane;
  private readonly work: WorkPane;
  private challenge: PublicChallenge | null = null;
  private busy = false;
  /** End of the server's wrong-answer lockout (server clock, epoch ms); 0 = not locked. */
  private lockedUntil = 0;
  private revealed: HintReveal[] = [];
  private ticker: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: SqlPanelControllerDeps) {
    this.problem = new ProblemPane(deps.panel.slots.problem);
    this.work = new WorkPane(deps.panel.slots.work, {
      onRun: () => void this.run(),
      onSubmit: () => void this.submit(),
      onHint: () => void this.hint(),
    });
    this.problem.showMessage('No task yet.');
  }

  /** Asks the server for a task and opens the panel on it. */
  async start(rewardKey: string, target?: string): Promise<void> {
    const { panel, api } = this.deps;
    this.challenge = null;
    this.revealed = [];
    this.work.setHint(null);
    this.clearLockout();
    this.work.editor.setReadOnly(false);
    this.problem.showMessage('Getting your task…');
    this.work.result.showIdle();
    panel.open();
    this.setBusy(true);
    try {
      const result = await api.request(rewardKey, target);
      if (!result.ok) {
        this.problem.showMessage(reasonMessage(result.reason, this.secondsUntil(result.retryAt)));
        return;
      }
      this.challenge = result.challenge;
      this.showHeader(result.challenge);
      this.problem.show(result.challenge);
      this.refreshHintButton();
      this.work.editor.focus();
    } catch (err) {
      this.problem.showMessage(this.describe(err));
    } finally {
      this.setBusy(false);
    }
  }

  /** Free preview of the current query. */
  async run(): Promise<void> {
    const challenge = this.challenge;
    if (!challenge || this.busy) return;
    const sql = this.work.editor.getValue().trim();
    if (!sql) {
      this.work.result.showMessage('Write a query first.');
      return;
    }
    this.setBusy(true);
    this.work.result.showMessage('Running…');
    try {
      this.showRunResult(await this.deps.api.run(challenge.id, sql));
    } catch (err) {
      this.work.result.showMessage(this.describe(err), 'error');
    } finally {
      this.setBusy(false);
    }
  }

  /** Reveals the next hint. The server orders and charges; we show what it returns. */
  async hint(): Promise<void> {
    const challenge = this.challenge;
    if (!challenge || this.busy || this.revealed.length >= challenge.hintCosts.length) return;
    this.setBusy(true);
    try {
      const result = await this.deps.api.hint(challenge.id, this.revealed.length);
      if (!result.ok) {
        this.work.result.showMessage(hintFailureMessage(result.reason), 'error');
        return;
      }
      this.revealed = [...this.revealed, result.hint];
      this.problem.showHints(this.revealed);
      this.refreshHintButton();
      if (result.hint.charged) this.deps.onHintCharged?.(result.hint);
    } catch (err) {
      this.work.result.showMessage(this.describe(err), 'error');
    } finally {
      this.setBusy(false);
    }
  }

  /** Graded attempt. The server decides; we only show its verdict. */
  async submit(): Promise<void> {
    const challenge = this.challenge;
    if (!challenge || this.busy) return;
    const sql = this.work.editor.getValue().trim();
    if (!sql) {
      this.work.result.showMessage('Write a query first.');
      return;
    }
    if (this.lockoutSeconds() > 0) {
      this.work.result.showMessage(
        `Locked out — try again in ${this.lockoutSeconds()} s.`,
        'wrong',
      );
      return;
    }
    this.setBusy(true);
    this.work.result.showMessage('Checking your answer…');
    try {
      this.showSubmitResult(await this.deps.api.submit(challenge.id, sql));
    } catch (err) {
      this.work.result.showMessage(this.describe(err), 'error');
    } finally {
      this.setBusy(false);
    }
  }

  destroy(): void {
    this.stopTicker();
    this.work.destroy();
  }

  private showSubmitResult(result: SubmitResult): void {
    const view = this.work.result;
    switch (result.status) {
      case 'correct':
        this.challenge = null;
        this.work.setHint(null);
        this.clearLockout();
        this.work.editor.setReadOnly(true);
        view.showWith(
          `✔ Correct! ${rewardLabel(result.rewardKey)} unlocked.`,
          'ok',
          h(
            'p',
            {},
            h('button', {
              class: 'sqlp-btn primary',
              text: 'Continue',
              attrs: { type: 'button' },
              on: { click: () => this.deps.panel.close() },
            }),
          ),
        );
        this.deps.onSolved?.({ rewardKey: result.rewardKey, target: result.target });
        return;
      case 'wrong':
        view.showMessage(`✘ Not quite. ${result.feedback.message}`, 'wrong');
        this.lockOut(result.lockedUntil);
        return;
      case 'locked': {
        this.lockOut(result.lockedUntil);
        view.showMessage(`Locked out — try again in ${this.lockoutSeconds()} s.`, 'wrong');
        return;
      }
      case 'rejected':
        view.showMessage(reasonMessage(result.reason, this.secondsUntil(result.retryAt)), 'error');
        return;
    }
  }

  private showRunResult(result: RunResult): void {
    const view = this.work.result;
    if (result.ok) {
      view.showPreview(result.preview.columns, result.preview.rows, result.preview.truncated);
    } else if (result.reason === 'sql') {
      view.showMessage(result.feedback.message, 'error');
    } else {
      view.showMessage(reasonMessage(result.reason, this.secondsUntil(result.retryAt)), 'error');
    }
  }

  private showHeader(challenge: PublicChallenge): void {
    const { slots } = this.deps.panel;
    slots.title.textContent = challenge.title;
    slots.tier.textContent = `T${challenge.tier}`;
    this.deps.panel.setBarText(challenge.title, '');
  }

  // --- wrong-answer lockout: the server decides the end time; we count down to it.

  private lockOut(until: number): void {
    this.lockedUntil = until;
    this.work.setSubmitLocked(true);
    this.startTicker();
    this.tick();
  }

  private clearLockout(): void {
    this.lockedUntil = 0;
    this.work.setSubmitLocked(false);
    this.work.setSubmitLabel();
    this.stopTicker();
  }

  private lockoutSeconds(): number {
    return this.lockedUntil === 0
      ? 0
      : Math.max(0, Math.ceil((this.lockedUntil - this.deps.api.serverNow()) / 1000));
  }

  private tick(): void {
    if (this.lockedUntil === 0) return;
    const seconds = this.lockoutSeconds();
    if (seconds > 0) {
      this.work.setSubmitLabel(`Locked ${seconds} s`);
      return;
    }
    this.clearLockout();
  }

  private startTicker(): void {
    this.ticker ??= setInterval(() => this.tick(), 250);
  }

  private stopTicker(): void {
    clearInterval(this.ticker);
    this.ticker = undefined;
  }

  private refreshHintButton(): void {
    const challenge = this.challenge;
    if (
      !challenge ||
      challenge.hintCosts.length === 0 ||
      this.revealed.length >= challenge.hintCosts.length
    ) {
      this.work.setHint(null);
      return;
    }
    const n = this.revealed.length;
    const cost = hintCostText(challenge.hintCosts[n] ?? 0, challenge.hintCostMode);
    this.work.setHint(
      `Hint ${n + 1}/${challenge.hintCosts.length} · ${cost}`,
      `Reveal the next hint (${cost})`,
    );
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.work.setBusy(busy || this.challenge === null);
  }

  private secondsUntil(serverTime: number | undefined): number | undefined {
    return serverTime === undefined
      ? undefined
      : Math.max(0, Math.ceil((serverTime - this.deps.api.serverNow()) / 1000));
  }

  private describe(err: unknown): string {
    return err instanceof ChallengeConnectionError
      ? CONNECTION_MESSAGE
      : 'Something went wrong. Try again.';
  }
}
