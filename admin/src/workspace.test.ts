import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@heist/shared';

describe('admin workspace', () => {
  it('resolves @heist/shared from source', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});
