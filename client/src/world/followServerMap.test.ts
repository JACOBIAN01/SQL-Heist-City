import { describe, expect, it } from 'vitest';
import { followServerMap } from './followServerMap';

describe('followServerMap', () => {
  it('stays put when client and server already agree', () => {
    expect(followServerMap('city', 'city', '?map=city')).toBeUndefined();
  });

  it('switches to the server’s city, keeping the other parameters', () => {
    expect(followServerMap('sandbox', 'city:class-7', '?name=Ana&debug')).toBe(
      '?name=Ana&debug=&map=city%3Aclass-7',
    );
    expect(followServerMap('city', 'heist', '?map=city')).toBe('?map=heist');
  });

  it('does not reload for a map the client cannot build (no reload loop)', () => {
    expect(followServerMap('sandbox', 'bench', '')).toBeUndefined();
  });
});
