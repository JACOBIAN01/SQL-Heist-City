import { describe, expect, it } from 'vitest';
import { createLogger, loggable } from './log';

const capture = (level?: 'debug' | 'info' | 'warn' | 'error') => {
  const lines: { line: Record<string, unknown>; level: string }[] = [];
  const log = createLogger({
    service: 'game',
    ...(level ? { level } : {}),
    now: () => new Date('2026-10-17T10:00:00Z'),
    write: (line, lvl) =>
      lines.push({ line: JSON.parse(line) as Record<string, unknown>, level: lvl }),
  });
  return { log, lines };
};

describe('structured logs (20.4)', () => {
  it('writes one JSON object per line with time, level, service and the fields', () => {
    const { log, lines } = capture();
    log.info('round ended', { classId: 7, round: 3 });
    expect(lines[0]?.line).toEqual({
      time: '2026-10-17T10:00:00.000Z',
      level: 'info',
      service: 'game',
      msg: 'round ended',
      classId: 7,
      round: 3,
    });
  });

  it('drops lines below the level, and sends errors to the error stream', () => {
    const { log, lines } = capture('warn');
    log.info('quiet');
    log.debug('quieter');
    log.warn('careful');
    log.error('broken', { err: new Error('boom') });
    expect(lines.map((l) => [l.line.level, l.level])).toEqual([
      ['warn', 'warn'],
      ['error', 'error'],
    ]);
    expect((lines[1]?.line.err as { message: string }).message).toBe('boom');
  });

  it('hides anything that looks like a secret or an answer, at any depth', () => {
    expect(
      loggable({
        ticket: 'abc',
        nested: { password: 'p', INTERNAL_SECRET: 's', fine: 1 },
        list: [{ cookie: 'c' }],
        reference_sql: 'SELECT 1',
      }),
    ).toEqual({
      ticket: '[redacted]',
      nested: { password: '[redacted]', INTERNAL_SECRET: '[redacted]', fine: 1 },
      list: [{ cookie: '[redacted]' }],
      reference_sql: '[redacted]',
    });
  });

  it('carries child fields on every line and shortens huge values', () => {
    const { log, lines } = capture();
    log.child({ player: 'p1' }).info('hit', { text: 'x'.repeat(5000) });
    expect(lines[0]?.line.player).toBe('p1');
    expect(String(lines[0]?.line.text).length).toBeLessThan(2100);
  });
});

describe('personal data in free text (21.5)', () => {
  it('masks emails, bearer tokens and JWTs wherever they appear, including in errors', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc_DEF-123';
    const out = loggable({
      msg: `duplicate key for ana.silva@school.edu with Bearer abc123.def and ${jwt}`,
      err: new Error('could not notify bob@gmail.com'),
      list: ['carol+tag@sub.school.org'],
    }) as Record<string, unknown>;
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/school\.edu|gmail|school\.org|abc123|eyJ/);
    expect(out.msg).toBe('duplicate key for [email] with Bearer [redacted] and [jwt]');
  });

  it('leaves ordinary text alone', () => {
    expect(loggable('match 7 listening on port 8080 (build 2026.10)')).toBe(
      'match 7 listening on port 8080 (build 2026.10)',
    );
  });
});
