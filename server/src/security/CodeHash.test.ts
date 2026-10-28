import { describe, expect, it } from 'vitest';
import { hashCode, verifyCode } from './CodeHash';

describe('CodeHash', () => {
  it('verifies only the code it was made from, with a different salt each time', async () => {
    const a = await hashCode('open-sesame');
    const b = await hashCode('open-sesame');
    expect(a).not.toBe(b);
    expect(a).not.toContain('open-sesame');
    expect(await verifyCode('open-sesame', a)).toBe(true);
    expect(await verifyCode('open-sesame ', a)).toBe(false);
    expect(await verifyCode('', a)).toBe(false);
  });

  it('says no to an empty or broken hash', async () => {
    expect(await verifyCode('x', '')).toBe(false);
    expect(await verifyCode('x', 'bcrypt$1$2')).toBe(false);
    expect(await verifyCode('x', 'scrypt$16384$8$1$')).toBe(false);
  });
});
