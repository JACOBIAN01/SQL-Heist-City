import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMITS } from '@heist/shared';
import { startAdmin } from '../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

describe('admin rate limits (18.2)', () => {
  it('answers 429 once an address is over the API limit', async () => {
    h = await startAdmin({
      rateLimits: {
        ...DEFAULT_RATE_LIMITS,
        adminApiPerIp: { burst: 3, perMinute: 1 },
        authPerIp: { burst: 100, perMinute: 100 },
      },
    });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await h.client.get('/api/questions')).status);
    expect(codes).toEqual([401, 401, 401, 429]);
    expect((await h.client.get('/health')).status).toBe(200); // not an API call
  });

  it('limits the sign-in routes more tightly than the rest of the API', async () => {
    h = await startAdmin({
      rateLimits: {
        ...DEFAULT_RATE_LIMITS,
        adminApiPerIp: { burst: 100, perMinute: 100 },
        authPerIp: { burst: 2, perMinute: 1 },
      },
    });
    const login = () =>
      h?.client.post('/api/auth/login', { email: 'x@school.test', password: 'nope-nope-nope' });
    expect((await login())?.status).toBe(401);
    expect((await login())?.status).toBe(401);
    expect((await login())?.status).toBe(429);
    // Other API routes still answer.
    expect((await h.client.get('/api/questions')).status).toBe(401);
  });
});
