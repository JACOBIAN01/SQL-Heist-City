import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script, shared with the shell
import { scan } from '../../../scripts/scan-logs.mjs';

const what = (text: string): string[] => (scan(text) as { what: string }[]).map((f) => f.what);

describe('log scan (21.5)', () => {
  it('finds emails, tokens, tickets in URLs, Google ids, cookies and public addresses', () => {
    expect(what('{"msg":"hello ana@school.edu"}')).toEqual(['an email address']);
    expect(what('Authorization: Bearer abcdef123456')).toEqual(['a bearer token']);
    expect(what('GET /?ticket=abcdef12 HTTP/1.1')).toEqual(['a ticket or token in a URL']);
    expect(what('sub 104857293847562910384')).toEqual(['a Google account id']);
    expect(what('cookie heist_player=abcdefgh1234')).toEqual(['a session cookie']);
    expect(what('from 203.0.113.9 connected')).toEqual(['a public IP address']);
    expect(what('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig')).toContain('a JWT');
  });

  it('lets through what our own logger writes, private addresses and version numbers', () => {
    expect(
      what(
        '{"time":"2026-10-17T10:00:00.000Z","level":"info","service":"game","msg":"match listening","match":1,"port":44245}\n' +
          'proxy 172.18.0.5 and 127.0.0.1 and 10.0.0.3, node 24.22.0, Bearer [redacted], ticket=[redacted], mail [email]\n' +
          '{"msg":"anomaly","kind":"speed","player":"p17","accountId":42}',
      ),
    ).toEqual([]);
  });

  it('never repeats the value it found', () => {
    expect(JSON.stringify(scan('ana@school.edu'))).not.toContain('ana');
  });
});
