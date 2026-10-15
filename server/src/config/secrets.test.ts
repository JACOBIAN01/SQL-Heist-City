import { describe, expect, it } from 'vitest';
import { secretProblems } from './secrets';

const strong = 'k3J9xq2L7mP0vR5tY8wN1bC4dF6gH9jK';
const strong2 = 'Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6';

describe('production secrets (18.5)', () => {
  it('checks nothing outside production', () => {
    expect(secretProblems({}, { required: ['TICKET_SECRET'] })).toEqual([]);
  });

  it('refuses missing, short, placeholder and shared secrets', () => {
    const env = { NODE_ENV: 'production' };
    expect(secretProblems(env, { required: ['TICKET_SECRET'] })).toEqual([
      'TICKET_SECRET is required in production',
    ]);
    expect(
      secretProblems(
        { ...env, TICKET_SECRET: 'dev-ticket-secret', INTERNAL_SECRET: 'short' },
        { required: ['TICKET_SECRET'], optional: ['INTERNAL_SECRET', 'COOKIE_SECRET'] },
      ),
    ).toEqual([
      'TICKET_SECRET is a development placeholder',
      'INTERNAL_SECRET is shorter than 32 characters',
    ]);
    expect(
      secretProblems(
        { ...env, TICKET_SECRET: strong, INTERNAL_SECRET: strong },
        { required: ['TICKET_SECRET'], optional: ['INTERNAL_SECRET'] },
      ),
    ).toEqual(['INTERNAL_SECRET is the same as TICKET_SECRET; use a different secret for each']);
    expect(
      secretProblems(
        { ...env, TICKET_SECRET: strong, INTERNAL_SECRET: strong2 },
        { required: ['TICKET_SECRET'], optional: ['INTERNAL_SECRET'] },
      ),
    ).toEqual([]);
  });

  it('never puts a secret value in a message', () => {
    const out = secretProblems(
      { NODE_ENV: 'production', TICKET_SECRET: 'tooshort-but-private' },
      { required: ['TICKET_SECRET'] },
    ).join(' ');
    expect(out).not.toContain('tooshort-but-private');
  });
});
