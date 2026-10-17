import { describe, expect, it } from 'vitest';
import type { ClientError } from '@heist/shared';
import { ErrorReporter } from './ErrorReporter';

function setup(over: { maxPerLoad?: number; minGapMs?: number } = {}) {
  const sent: ClientError[] = [];
  let t = 0;
  const target = new EventTarget();
  const reporter = new ErrorReporter({
    send: (r) => sent.push(r),
    page: () => '/',
    userAgent: 'TestBrowser/1',
    now: () => t,
    minGapMs: 0,
    ...over,
  });
  reporter.install(target as unknown as Window);
  return { reporter, sent, target, tick: (ms: number) => (t += ms) };
}

describe('client error reporting (20.5)', () => {
  it('reports a thrown error and an unhandled rejection with page and browser', () => {
    const { sent, target } = setup();
    target.dispatchEvent(
      Object.assign(new Event('error'), {
        error: new TypeError('x is undefined'),
        message: 'x is undefined',
      }),
    );
    target.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('socket failed') }),
    );
    expect(sent.map((r) => [r.source, r.message, r.page, r.userAgent])).toEqual([
      ['error', 'TypeError: x is undefined', '/', 'TestBrowser/1'],
      ['unhandledrejection', 'Error: socket failed', '/', 'TestBrowser/1'],
    ]);
    expect(sent[0]?.stack).toContain('TypeError');
  });

  it('ignores failed image and script loads, which carry no error', () => {
    const { sent, target } = setup();
    target.dispatchEvent(new Event('error'));
    expect(sent).toEqual([]);
  });

  it('removes query strings, tickets and codes from what it sends', () => {
    const { reporter, sent } = setup();
    const err = new Error(
      'failed to load http://localhost:5173/?class=7&ticket=abc123 with code=9f2',
    );
    err.stack = 'Error: x\n    at fn (http://localhost:5173/assets/main.js?v=1&token=zzz:10:5)';
    reporter.report('error', err);
    expect(sent[0]?.message).toBe(
      'Error: failed to load http://localhost:5173/ with code=[redacted]',
    );
    expect(sent[0]?.stack).toBe('Error: x\n    at fn (http://localhost:5173/assets/main.js:10:5)');
    expect(JSON.stringify(sent[0])).not.toMatch(/abc123|zzz|class=7/);
  });

  it('sends the same error once, and no more than the limit per load', () => {
    const { reporter, sent } = setup({ maxPerLoad: 3 });
    for (let i = 0; i < 5; i++) reporter.report('error', new Error('same'));
    expect(sent).toHaveLength(1);
    for (let i = 0; i < 10; i++) reporter.report('error', new Error(`different ${i}`));
    expect(sent).toHaveLength(3);
  });

  it('spaces reports apart, and never throws when sending fails', () => {
    const calls: string[] = [];
    let t = 0;
    const reporter = new ErrorReporter({
      send: (r) => {
        calls.push(r.message);
        throw new Error('network down');
      },
      page: () => '/',
      now: () => t,
      minGapMs: 1000,
    });
    expect(() => reporter.report('error', 'a')).not.toThrow();
    reporter.report('error', 'b'); // too soon
    t += 1500;
    reporter.report('error', 'c');
    expect(calls).toEqual(['a', 'c']);
  });
});
