import type {
  HintResult,
  IssueResult,
  PublicChallenge,
  RunResult,
  SubmitResult,
} from '@heist/shared';
import type { ChallengeApi } from '../net/ChallengeApi';

export function sampleChallenge(over: Partial<PublicChallenge> = {}): PublicChallenge {
  return {
    id: 'c1',
    rewardKey: 'heal:small',
    tier: 1,
    title: 'Payroll Leak',
    story: 'List **everyone**.',
    schemaSql: 'CREATE TABLE employees (id INTEGER, name TEXT);',
    tables: [
      { name: 'employees', columns: ['id', 'name'], sampleRows: [[1, 'Ana']], rowCount: 10 },
    ],
    hintCosts: [0.05, 0.1],
    hintCostMode: 'fraction',
    expiresAt: 1_300_000,
    ...over,
  };
}

/** Scriptable ChallengeApi: tests set the handlers and inspect `calls`. */
export class FakeChallengeApi implements ChallengeApi {
  readonly calls: { method: string; args: unknown[] }[] = [];
  clock = 1_000_000;
  onRequest: (rewardKey: string, target?: string) => Promise<IssueResult> = async () => ({
    ok: true,
    challenge: sampleChallenge(),
  });
  onRun: (id: string, sql: string) => Promise<RunResult> = async () => ({
    ok: true,
    preview: { columns: ['name'], rows: [['Ana']], truncated: false },
  });
  onSubmit: (id: string, sql: string) => Promise<SubmitResult> = async () => ({
    status: 'correct',
    rewardKey: 'heal:small',
    target: null,
  });

  onHint: (id: string, index: number) => Promise<HintResult> = async (_id, index) => ({
    ok: true,
    hint: {
      index,
      text: `Hint number ${index + 1}`,
      cost: [0.05, 0.1][index] ?? 0,
      costMode: 'fraction',
      charged: true,
    },
  });

  hint(id: string, index: number): Promise<HintResult> {
    this.calls.push({ method: 'hint', args: [id, index] });
    return this.onHint(id, index);
  }

  request(rewardKey: string, target?: string): Promise<IssueResult> {
    this.calls.push({ method: 'request', args: [rewardKey, target] });
    return this.onRequest(rewardKey, target);
  }

  run(id: string, sql: string): Promise<RunResult> {
    this.calls.push({ method: 'run', args: [id, sql] });
    return this.onRun(id, sql);
  }

  submit(id: string, sql: string): Promise<SubmitResult> {
    this.calls.push({ method: 'submit', args: [id, sql] });
    return this.onSubmit(id, sql);
  }

  async abandon(): Promise<void> {
    this.calls.push({ method: 'abandon', args: [] });
  }

  serverNow(): number {
    return this.clock;
  }

  close(): void {}
}
