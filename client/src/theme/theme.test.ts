import { afterEach, describe, expect, it } from 'vitest';
import { theme } from './theme';

afterEach(() => theme.set('default'));

describe('theme', () => {
  it('writes money and names in the chosen country’s way, and goes back to the default', () => {
    expect(theme.money(2_500_000)).toBe('$2,500,000');
    theme.set('india');
    expect(theme.money(2_500_000)).toBe('₹25,00,000');
    expect(theme.text('Mae at Corner Savings banked $2,500,000')).toBe(
      'Meera at Gram Sahakari Bank banked ₹25,00,000',
    );
    theme.set('narnia');
    expect(theme.id).toBe('default');
    expect(theme.text('Mae at Corner Savings')).toBe('Mae at Corner Savings');
  });
});
