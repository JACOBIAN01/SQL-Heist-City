/**
 * The tiny Markdown subset question stories use: **bold**, `code` and line
 * breaks. Parsing is shared; each UI (React admin, DOM client) turns the
 * tokens into elements itself, so story text can never inject markup.
 */
export type InlineToken =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string };

/** One array of tokens per line of input. */
export function parseInlineMarkdown(source: string): InlineToken[][] {
  return source.split('\n').map(parseLine);
}

function parseLine(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  for (const part of line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
    if (part === '') continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      tokens.push({ kind: 'bold', text: part.slice(2, -2) });
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      tokens.push({ kind: 'code', text: part.slice(1, -1) });
    } else {
      tokens.push({ kind: 'text', text: part });
    }
  }
  return tokens;
}
