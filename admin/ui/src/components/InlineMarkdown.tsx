import { parseInlineMarkdown } from '@heist/shared';

/** Renders the shared inline-Markdown tokens as React elements (never innerHTML). */
export function InlineMarkdown({ text }: { text: string }) {
  const lines = parseInlineMarkdown(text);
  return (
    <>
      {lines.map((tokens, i) => (
        <span key={i}>
          {tokens.map((t, j) =>
            t.kind === 'bold' ? (
              <strong key={j}>{t.text}</strong>
            ) : t.kind === 'code' ? (
              <code key={j}>{t.text}</code>
            ) : (
              t.text
            ),
          )}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}
