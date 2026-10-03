#!/usr/bin/env node
// Fails when the built client code outgrows its budget (docs/frontend.md:
// code < 1 MB gzipped; the whole first load, assets included, < 8 MB).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 1024 * 1024; // gzipped JS + CSS
const dist = fileURLToPath(new URL('../client/dist', import.meta.url));

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

let total = 0;
const rows = [];
for (const path of files(dist).filter((f) => /\.(js|css)$/.test(f))) {
  const gz = gzipSync(readFileSync(path)).length;
  total += gz;
  rows.push([path.slice(dist.length + 1), gz]);
}
rows.sort((a, b) => b[1] - a[1]);
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
for (const [name, gz] of rows) console.log(`${kb(gz).padStart(9)}  ${name}`);
console.log(`${kb(total).padStart(9)}  total gzipped code (budget ${kb(BUDGET_BYTES)})`);
if (total > BUDGET_BYTES) {
  console.error('✗ client code is over budget');
  process.exit(1);
}
