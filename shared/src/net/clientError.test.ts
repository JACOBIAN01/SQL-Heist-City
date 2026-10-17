import { describe, expect, it } from 'vitest';
import { clientErrorSchema, scrubErrorText } from './clientError';

describe('error reports from browsers (20.5, 21.5)', () => {
  it('scrub URLs, tickets and email addresses', () => {
    expect(
      scrubErrorText('failed http://h/?class=7&ticket=abc for ana@school.edu with code=9f2'),
    ).toBe('failed http://h/ for [email] with code=[redacted]');
  });

  it('accepts a small report and refuses a big or odd one', () => {
    const ok = { message: 'x', source: 'error', page: '/' };
    expect(clientErrorSchema.safeParse(ok).success).toBe(true);
    expect(clientErrorSchema.safeParse({ ...ok, message: 'x'.repeat(501) }).success).toBe(false);
    expect(clientErrorSchema.safeParse({ ...ok, source: 'other' }).success).toBe(false);
    expect(clientErrorSchema.safeParse({ message: 'x' }).success).toBe(false);
  });
});
