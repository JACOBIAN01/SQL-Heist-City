import { createHmac, timingSafeEqual } from 'node:crypto';

/** `base64url(json).signature` — a value the browser carries but cannot change. */
export function signValue(secret: string, value: unknown): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function readSigned<T>(secret: string, text: string | undefined): T | undefined {
  const [body, signature, extra] = (text ?? '').split('.');
  if (!body || !signature || extra !== undefined) return undefined;
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return undefined;
  }
}
