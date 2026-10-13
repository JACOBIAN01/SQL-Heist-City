import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANALYTICS_SETTINGS,
  RCSBE_NAMES,
  marksFor,
  analyticsSettingsSchema,
} from './analytics';
import { compareToTarget, coverageOf, shapeProblems, type TaggedQuestion } from './coverage';
import { parseStoredTemplate, questionTemplateSchema } from './template';
import { sampleQuestion } from './fixtures';

const q = (
  tier: number,
  rcsbe: TaggedQuestion['rcsbe'],
  bloom: TaggedQuestion['bloom'] = 'apply',
  marks?: number,
): TaggedQuestion => ({
  tier,
  rcsbe,
  bloom,
  ...(marks === undefined ? {} : { marks }),
});

describe('question tags', () => {
  it('refuse a missing tag, two tags, or an unknown one', () => {
    const { rcsbe: _r, ...noRcsbe } = sampleQuestion;
    expect(questionTemplateSchema.safeParse(noRcsbe).success).toBe(false);
    expect(questionTemplateSchema.safeParse({ ...sampleQuestion, rcsbe: ['S', 'C'] }).success).toBe(
      false,
    );
    expect(questionTemplateSchema.safeParse({ ...sampleQuestion, rcsbe: 'X' }).success).toBe(false);
    expect(questionTemplateSchema.safeParse({ ...sampleQuestion, bloom: 'memorise' }).success).toBe(
      false,
    );
    expect(questionTemplateSchema.safeParse({ ...sampleQuestion, marks: 0 }).success).toBe(false);
    expect(questionTemplateSchema.safeParse(sampleQuestion).success).toBe(true);
  });

  it('read back as Solve / Apply when stored before the tags existed', () => {
    const { rcsbe: _r, bloom: _b, ...old } = sampleQuestion;
    expect(parseStoredTemplate(old)).toMatchObject({ rcsbe: 'S', bloom: 'apply' });
    expect(parseStoredTemplate({ ...old, rcsbe: 'C', bloom: 'understand' })).toMatchObject({
      rcsbe: 'C',
      bloom: 'understand',
    });
  });

  it('are worth the tier’s default marks unless the question says otherwise', () => {
    expect(marksFor({ tier: 3 })).toBe(3);
    expect(marksFor({ tier: 3, marks: 8 })).toBe(8);
    const custom = analyticsSettingsSchema.parse({ marksByTier: { '3': 6 } });
    expect(marksFor({ tier: 3 }, custom)).toBe(6);
  });
});

describe('coverageOf', () => {
  it('shows today’s gap: everything is Solve, the other four dimensions are empty', () => {
    const report = coverageOf([q(1, 'S'), q(2, 'S'), q(5, 'S', 'analyze')]);
    expect(report).toMatchObject({ items: 3, marks: 8 });
    expect(report.byDimension.S).toEqual({ items: 3, marks: 8 });
    expect(report.emptyDimensions).toEqual(['R', 'C', 'B', 'E']);
    expect(report.emptyBloom).toEqual(['remember', 'understand', 'evaluate', 'create']);
    expect(report.byTier[5]?.S).toBe(1);
  });

  it('counts marks, not just items', () => {
    const report = coverageOf([q(1, 'R', 'remember'), q(5, 'C', 'understand', 10)]);
    expect(report.byDimension.R.marks).toBe(1);
    expect(report.byDimension.C.marks).toBe(10);
  });
});

describe('compareToTarget', () => {
  const target = DEFAULT_ANALYTICS_SETTINGS.targetProfile;

  it('flags a dimension that is missing, low or too high', () => {
    const rows = compareToTarget(coverageOf([q(3, 'S'), q(3, 'S'), q(3, 'S')]), target);
    const by = Object.fromEntries(rows.map((r) => [r.dimension, r.status]));
    expect(by).toEqual({ R: 'missing', C: 'missing', S: 'high', B: 'missing', E: 'missing' });
    expect(shapeProblems(rows, RCSBE_NAMES)).toContain('Comprehend has no questions, target 25%');
  });

  it('is happy when the shape is near the target', () => {
    const set = [
      ...Array(1).fill(q(1, 'R')),
      ...Array(2).fill(q(1, 'C')),
      ...Array(4).fill(q(1, 'S')),
      ...Array(1).fill(q(1, 'B')),
      ...Array(2).fill(q(1, 'E')),
    ];
    const rows = compareToTarget(coverageOf(set), target);
    expect(rows.every((r) => r.status === 'ok')).toBe(true);
    expect(shapeProblems(rows, RCSBE_NAMES)).toEqual([]);
  });

  it('says low when a dimension is present but thin', () => {
    const set = [...Array(20).fill(q(1, 'S')), q(1, 'C')];
    const rows = compareToTarget(coverageOf(set), target);
    expect(rows.find((r) => r.dimension === 'C')?.status).toBe('low');
  });
});
