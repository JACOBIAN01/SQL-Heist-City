import type { PublicChallenge, RunResult } from '@heist/shared';
import { ChallengeConnectionError, type ChallengeApi } from '../../net/ChallengeApi';
import { CONNECTION_MESSAGE, reasonMessage } from './messages';
import { ProblemPane } from './ProblemPane';
import type { SqlPanel } from './SqlPanel';
import { WorkPane } from './WorkPane';

export interface SqlPanelControllerDeps {
  readonly panel: SqlPanel;
  readonly api: ChallengeApi;
}

// Pattern: Facade — Why: the game talks to one object ("start a task") while
// the panel's pieces (problem pane, editor, results, network) stay hidden and
// individually testable behind it.
export class SqlPanelController {
  private readonly problem: ProblemPane;
  private readonly work: WorkPane;
  private challenge: PublicChallenge | null = null;
  private busy = false;

  constructor(private readonly deps: SqlPanelControllerDeps) {
    this.problem = new ProblemPane(deps.panel.slots.problem);
    this.work = new WorkPane(deps.panel.slots.work, { onRun: () => void this.run() });
    this.problem.showMessage('No task yet.');
  }

  /** Asks the server for a task and opens the panel on it. */
  async start(rewardKey: string, target?: string): Promise<void> {
    const { panel, api } = this.deps;
    this.challenge = null;
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

  destroy(): void {
    this.work.destroy();
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
