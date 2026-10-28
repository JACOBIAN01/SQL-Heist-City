import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

const scrypt = (code: string, salt: Buffer, keylen: number, N: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(code, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

/**
 * One-way hash for a short secret such as the cheat code (scrypt, with the parameters stored in the
 * hash so they can be raised later). The admin makes the hash; the game server only verifies.
 */
export async function hashCode(code: string): Promise<string> {
  const [N, r, p, keylen] = [16_384, 8, 1, 32];
  const salt = randomBytes(16);
  const key = await scrypt(code, salt, keylen, N, r, p);
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** Whether `code` is the one `stored` was made from; false for an empty or malformed hash. */
export async function verifyCode(code: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const want = Buffer.from(expected, 'base64url');
  const got = await scrypt(
    code,
    Buffer.from(salt, 'base64url'),
    want.length,
    Number(N),
    Number(r),
    Number(p),
  );
  return got.length === want.length && timingSafeEqual(got, want);
}
