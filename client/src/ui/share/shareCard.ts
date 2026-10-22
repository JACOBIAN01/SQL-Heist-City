import { AWARDS, type AwardView, type ReviewItem } from '@heist/shared';
import { formatAward } from '../hud/ScoreboardView';

/** What goes on a card. All of it is the student's own, and a card is only made when they ask. */
export interface ShareCardInput {
  readonly name: string;
  readonly round: number;
  /** 1-based place and how many were ranked, if known. */
  readonly rank?: number;
  readonly players?: number;
  readonly banked: number;
  readonly kills: number;
  /** The awards this student won. */
  readonly awards: readonly AwardView[];
  /** The question items of the round, to pick the best query from. */
  readonly items: readonly ReviewItem[];
}

export interface ShareCardOptions {
  readonly showQuery: boolean;
  readonly maxQueryLines: number;
}

export interface CardModel {
  readonly title: string;
  readonly round: string;
  readonly name: string;
  /** Big numbers: a label and its value. */
  readonly stats: readonly { readonly label: string; readonly value: string }[];
  readonly awards: readonly string[];
  readonly query?: {
    readonly heading: string;
    readonly detail: string;
    readonly sql: readonly string[];
  };
  readonly footer: string;
}

/** The round's best query: the highest tier solved with a query written, the fastest of those. */
export function bestQuery(items: readonly ReviewItem[]): ReviewItem | undefined {
  return items
    .filter((i) => i.outcome === 'solved' && i.yourSql && i.yourSql.trim() !== '')
    .sort((a, b) => b.tier - a.tier || a.secondsOpen - b.secondsOpen)[0];
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Tidies a query for a card: trims, drops blank lines, and cuts it to `maxLines` with an ellipsis. */
export function queryLines(sql: string, maxLines: number): string[] {
  const lines = sql
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '');
  return lines.length > maxLines ? [...lines.slice(0, maxLines - 1), '…'] : lines;
}

/** Works out what the card says, with no drawing (so it can be tested and reused). */
export function buildCard(input: ShareCardInput, options: ShareCardOptions): CardModel {
  const best = options.showQuery ? bestQuery(input.items) : undefined;
  return {
    title: 'SQL HEIST CITY',
    round: `Round ${input.round}`,
    name: input.name,
    stats: [
      ...(input.rank !== undefined
        ? [
            {
              label: 'Place',
              value: input.players ? `#${input.rank} of ${input.players}` : `#${input.rank}`,
            },
          ]
        : []),
      { label: 'Haul', value: money(input.banked) },
      { label: 'Kills', value: String(input.kills) },
    ],
    awards: input.awards.map((a) => {
      const info = AWARDS[a.id];
      return `${info.title} · ${formatAward(a.value, info.unit)}`;
    }),
    ...(best && best.yourSql
      ? {
          query: {
            heading: 'Best query',
            detail: `Tier ${best.tier} · solved in ${best.secondsOpen} s`,
            sql: queryLines(best.yourSql, options.maxQueryLines),
          },
        }
      : {}),
    footer: 'Learn SQL by playing',
  };
}

/** The part of a 2D canvas context the card is drawn with (a recorder can stand in for it in tests). */
export interface Pen {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
}

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
const PAD = 72;
const COLORS = {
  bg: '#12161d',
  panel: '#1c232e',
  text: '#f2f4f8',
  muted: '#9aa6b8',
  accent: '#4da3ff',
  good: '#7be08f',
};

/** Cuts a line to fit `width`, ending in an ellipsis. */
export function fit(pen: Pen, text: string, width: number): string {
  if (pen.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && pen.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Draws a card onto a pen. Every line is cut to fit, so a long name or query never runs off the edge. */
export function drawCard(pen: Pen, card: CardModel): void {
  const inner = CARD_WIDTH - 2 * PAD;
  pen.fillStyle = COLORS.bg;
  pen.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  pen.fillStyle = COLORS.accent;
  pen.fillRect(0, 0, CARD_WIDTH, 16);
  pen.textBaseline = 'alphabetic';
  pen.textAlign = 'left';
  let y = 150;
  const line = (text: string, font: string, color: string, gap: number, x = PAD, width = inner) => {
    pen.font = font;
    pen.fillStyle = color;
    pen.fillText(fit(pen, text, width), x, y);
    y += gap;
  };
  line(card.title, '700 44px system-ui, sans-serif', COLORS.accent, 64);
  line(card.round, '500 36px system-ui, sans-serif', COLORS.muted, 90);
  line(card.name, '700 84px system-ui, sans-serif', COLORS.text, 120);

  // The numbers, side by side.
  const colWidth = inner / Math.max(1, card.stats.length);
  const top = y;
  card.stats.forEach((s, i) => {
    const x = PAD + i * colWidth;
    y = top;
    line(
      s.label.toUpperCase(),
      '600 26px system-ui, sans-serif',
      COLORS.muted,
      52,
      x,
      colWidth - 16,
    );
    line(s.value, '700 54px system-ui, sans-serif', COLORS.text, 0, x, colWidth - 16);
  });
  y = top + 130;

  if (card.awards.length > 0) {
    line('AWARDS', '600 26px system-ui, sans-serif', COLORS.muted, 52);
    for (const a of card.awards.slice(0, 4))
      line(`★ ${a}`, '600 40px system-ui, sans-serif', COLORS.good, 58);
    y += 36;
  }

  if (card.query) {
    const lines = card.query.sql;
    const blockHeight = 150 + lines.length * 44;
    pen.fillStyle = COLORS.panel;
    pen.fillRect(PAD, y - 24, inner, blockHeight);
    y += 24;
    line(
      card.query.heading.toUpperCase(),
      '600 26px system-ui, sans-serif',
      COLORS.muted,
      44,
      PAD + 32,
      inner - 64,
    );
    line(
      card.query.detail,
      '500 30px system-ui, sans-serif',
      COLORS.text,
      56,
      PAD + 32,
      inner - 64,
    );
    for (const l of lines)
      line(l, '500 30px ui-monospace, Menlo, monospace', COLORS.text, 44, PAD + 32, inner - 64);
  }

  pen.textAlign = 'left';
  y = CARD_HEIGHT - 72;
  line(card.footer, '500 30px system-ui, sans-serif', COLORS.muted, 0);
}
