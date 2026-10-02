import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

/**
 * scrypt from node:crypto (memory-hard, no native dependency). Parameters are
 * stored with each hash so they can be raised later without breaking logins.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  constructor(private readonly params = { N: 16_384, r: 8, p: 1, keylen: 32 }) {}

  async hash(password: string): Promise<string> {
    const { N, r, p, keylen } = this.params;
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [scheme, N, r, p, salt, expected] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !expected) return false;
    const want = Buffer.from(expected, 'base64url');
    const got = await scrypt(password, Buffer.from(salt, 'base64url'), want.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return got.length === want.length && timingSafeEqual(got, want);
  }
}
