#!/usr/bin/env node
// Log audit (Phase 21.5): reads log text from files or standard input and fails if it holds
// personal data: email addresses, tokens, signed tickets, Google ids, or a person's address.
//   docker compose logs --no-log-prefix | node scripts/scan-logs.mjs
//   node scripts/scan-logs.mjs service.log other.log
import { readFileSync } from 'node:fs';

const RULES = [
  ['an email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g],
  ['a bearer token', /\bBearer\s+(?!\[redacted\])[A-Za-z0-9._~+/=-]{8,}/gi],
  ['a JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g],
  [
    'a ticket or token in a URL',
    /[?&](ticket|token|code|state|access_token|id_token)=(?!\[redacted\])[^&\s"']{6,}/gi,
  ],
  ['a Google account id', /\b1\d{20}\b/g],
  ['a session cookie', /\bheist_(player|session|admin)=[A-Za-z0-9._~%-]{8,}/g],
  // Public addresses of people. Loopback and private ranges (Docker, the proxy) are not people.
  [
    'a public IP address',
    /\b(?!(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01])|169\.254|0)\.)(?:\d{1,3}\.){3}\d{1,3}\b(?!\.\d)/g,
    (m, line) =>
      /version|v\d|\d+\.\d+\.\d+\.\d+\s*(?:KB|MB|ms)/i.test(line) ||
      m.split('.').some((n) => Number(n) > 255),
  ],
];

export function scan(text) {
  const findings = [];
  text.split('\n').forEach((line, i) => {
    for (const [what, pattern, ignore] of RULES) {
      for (const match of line.matchAll(pattern)) {
        if (ignore?.(match[0], line)) continue;
        // Never print the value itself: the report must not be the next leak.
        findings.push({ line: i + 1, what, at: match.index ?? 0 });
      }
    }
  });
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  const text =
    files.length > 0
      ? files.map((f) => readFileSync(f, 'utf8')).join('\n')
      : readFileSync(0, 'utf8');
  const findings = scan(text);
  const lines = text.split('\n').filter(Boolean).length;
  if (findings.length > 0) {
    console.error(`✗ personal data in the logs (${findings.length} finding(s) in ${lines} lines):`);
    for (const f of findings.slice(0, 20))
      console.error(`  line ${f.line}, column ${f.at}: ${f.what}`);
    process.exit(1);
  }
  console.log(`log scan: ${lines} lines, no personal data found`);
}
