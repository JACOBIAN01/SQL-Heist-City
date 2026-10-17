import { mkdtempSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script, shared with the shell
import { build, markdownToHtml, page, splitHeader } from '../../../scripts/build-legal.mjs';

describe('legal pages (21.2)', () => {
  it('turns the small Markdown the documents use into HTML, escaping everything else', () => {
    const html = markdownToHtml(
      '# Title\n\nSome **bold** and `code` and <script>alert(1)</script> [link](https://x.test).\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<a href="https://x.test">link</a>');
    expect(html).toContain('<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>2</td>');
  });

  it('shows a draft notice until the document says it has been reviewed', () => {
    const draft = page(
      splitHeader('---\ntitle: T\nreviewed: false\nupdated: 2026-10-17\n---\n# T\n'),
    );
    expect(draft).toContain('class="draft"');
    const done = page(
      splitHeader('---\ntitle: T\nreviewed: true\nupdated: 2026-10-17\n---\n# T\n'),
    );
    expect(done).not.toContain('class="draft"');
  });

  it('builds the three pages for the game and the admin from the real documents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legal-'));
    try {
      cpSync(new URL('../../../docs/legal', import.meta.url), join(dir, 'docs/legal'), {
        recursive: true,
      });
      const written = build(dir) as string[];
      expect(written).toHaveLength(6);
      const privacy = readFileSync(join(dir, 'client/public/legal/privacy.html'), 'utf8');
      expect(privacy).toContain('<h1>Privacy Policy</h1>');
      expect(privacy).toContain('The game is violent');
      expect(readFileSync(join(dir, 'admin/ui/public/legal/dpa.html'), 'utf8')).toContain(
        'Sub-processors',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
