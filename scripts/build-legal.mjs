#!/usr/bin/env node
// Turns docs/legal/*.md into plain pages the game and the admin serve (Phase 21.2).
//   node scripts/build-legal.mjs      (also run by `npm run build`)
// The pages show a visible DRAFT notice until the document's header says `reviewed: true`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = [
  ['privacy-policy.md', 'privacy.html'],
  ['terms.md', 'terms.html'],
  ['dpa.md', 'dpa.html'],
];
const OUTPUTS = ['client/public/legal', 'admin/ui/public/legal'];

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Bold, code and links; everything else is text. Applied to already-escaped text. */
function inline(text) {
  return escape(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>');
}

/** The small subset of Markdown the documents use: headings, paragraphs, lists, tables, rules. */
export function markdownToHtml(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let list = null;
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      flush();
      closeList();
    } else if (/^#{1,3} /.test(line)) {
      flush();
      closeList();
      const level = line.match(/^#+/)[0].length;
      out.push(`<h${level}>${inline(line.replace(/^#+ /, ''))}</h${level}>`);
    } else if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      flush();
      closeList();
      const cells = (l) =>
        l
          .trim()
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
      out.push(
        '<table><thead><tr>' +
          cells(line)
            .map((c) => `<th>${inline(c)}</th>`)
            .join('') +
          '</tr></thead><tbody>',
      );
      i += 2;
      for (; i < lines.length && /^\|.*\|\s*$/.test(lines[i]); i++)
        out.push(
          '<tr>' +
            cells(lines[i])
              .map((c) => `<td>${inline(c)}</td>`)
              .join('') +
            '</tr>',
        );
      out.push('</tbody></table>');
      i--;
    } else if (/^- /.test(line) || /^\d+\. /.test(line)) {
      flush();
      const kind = /^- /.test(line) ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline(line.replace(/^(- |\d+\. )/, ''))}</li>`);
    } else if (/^---+$/.test(line)) {
      flush();
      closeList();
      out.push('<hr>');
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flush();
  closeList();
  return out.join('\n');
}

/** `---` header: `key: value` lines. */
export function splitHeader(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return { header: {}, body: text };
  const header = Object.fromEntries(
    m[1].split('\n').map((l) => {
      const i = l.indexOf(':');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
  return { header, body: text.slice(m[0].length) };
}

export function page({ header, body }) {
  const reviewed = header.reviewed === 'true';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(header.title ?? 'SQL Heist City')} — SQL Heist City</title>
<style>
  body { font: 16px/1.6 system-ui, -apple-system, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; color: #1b1b1f; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #e8e8ee; background: #15151a; } a { color: #8ab4ff; } th { background: #25252c; } }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #8884; padding: .4rem .6rem; text-align: left; vertical-align: top; }
  th { background: #eee; }
  .draft { border: 2px solid #d4a017; padding: .6rem 1rem; border-radius: 6px; background: #d4a01722; }
  nav a { margin-right: 1rem; }
</style>
</head>
<body>
<nav><a href="/">← Back</a><a href="/legal/privacy.html">Privacy Policy</a><a href="/legal/terms.html">Terms</a><a href="/legal/dpa.html">Data Processing Agreement</a></nav>
${reviewed ? '' : '<p class="draft"><strong>Draft.</strong> This text has not yet been reviewed by a lawyer. Brackets [like this] are still to be filled in.</p>'}
${markdownToHtml(body)}
<p><small>Last updated ${escape(header.updated ?? '')}.</small></p>
</body>
</html>
`;
}

export function build(base = root) {
  const written = [];
  for (const out of OUTPUTS) {
    mkdirSync(join(base, out), { recursive: true });
    for (const [source, target] of PAGES) {
      const html = page(splitHeader(readFileSync(join(base, 'docs/legal', source), 'utf8')));
      writeFileSync(join(base, out, target), html);
      written.push(join(out, target));
    }
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`legal pages: wrote ${build().length} files`);
}
