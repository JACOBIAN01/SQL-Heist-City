#!/usr/bin/env node
// Secret scan (Phase 18.5): fails if a tracked file looks like it holds a real credential.
// Runs in `npm run ci`. Placeholders used in development and tests are listed below on purpose.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Patterns that are a secret wherever they appear. */
const TOKENS = [
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['API key (sk-)', /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/],
  // A `${VARIABLE}` reference or the word PASSWORD is a placeholder, not a password.
  [
    'database URL with a password',
    /\bpostgres(?:ql)?:\/\/[^\s:@/'"]+:(?!\$\{|PASSWORD@)[^\s@/'"]{6,}@/,
  ],
];

/** `SECRET = '…'`-style assignments of long literal values (outside tests and docs). */
const ASSIGNMENT =
  /\b[A-Z_]*(?:SECRET|PASSWORD|TOKEN|API_KEY)[A-Z_]*\b\s*[:=]\s*['"`]([^'"`\s]{12,})['"`]/;

/** Development and test placeholders: not secrets, and refused in production (secrets.ts). */
const PLACEHOLDERS = new Set(['dev-ticket-secret', 'not-configured']);

/** Shannon entropy in bits per character: random keys are high, names and URLs are low. */
function entropy(value) {
  const counts = new Map();
  for (const c of value) counts.set(c, (counts.get(c) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) bits -= (n / value.length) * Math.log2(n / value.length);
  return bits;
}
const looksRandom = (v) => !v.includes('://') && !/^[a-z0-9-]+$/.test(v) && entropy(v) >= 3.5;

const SKIP = /(^|\/)(package-lock\.json|.*\.(png|jpg|glb|bin|ico|woff2?|ogg|mp3|wav))$/;
const LENIENT = /(\.test\.[tj]sx?$|\/testing\/|^docs\/|\.md$)/;

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const problems = [];
for (const file of files) {
  if (/(^|\/)\.env(\..*)?$/.test(file) && !file.endsWith('.example'))
    problems.push(`${file}: an .env file is tracked`);
  if (SKIP.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of TOKENS) if (re.test(line)) problems.push(`${file}:${i + 1}: ${name}`);
    const m = ASSIGNMENT.exec(line);
    if (m && !LENIENT.test(file) && !PLACEHOLDERS.has(m[1] ?? '') && looksRandom(m[1] ?? ''))
      problems.push(`${file}:${i + 1}: a secret-looking value is assigned in code`);
  });
}
if (problems.length) {
  console.error(`✗ possible secrets in the repository:\n  ${problems.join('\n  ')}`);
  console.error('Move them to the environment (docs/deployment.md, "Secrets").');
  process.exit(1);
}
console.log(`secret scan: ${files.length} tracked files, nothing found`);
