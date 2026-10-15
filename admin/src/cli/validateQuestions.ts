import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLOOM_LEVELS,
  BLOOM_NAMES,
  RCSBE_DIMENSIONS,
  RCSBE_NAMES,
  compareToTarget,
  coverageOf,
  emptyCells,
  DEFAULT_ANALYTICS_SETTINGS,
  conceptFileSchema,
  questionTemplateSchema,
  shapeProblems,
} from '@heist/shared';
import { Grader } from '@heist/server/sql/Grader';
import { WorkerSandboxRunner } from '@heist/server/sql/WorkerSandboxRunner';
import { builtInDatasets } from '@heist/server/variants/datasets';
import { VariantBuilder } from '@heist/server/variants/VariantBuilder';
import { ContentValidator, type ContentFile } from '../questions/ContentValidator';
import { QuestionTester } from '../questions/QuestionTester';

/**
 * QA gate for question content files.
 *   npm run questions:validate               → all files in content/questions/
 *   npm run questions:validate -- a.json …   → specific files
 */
const args = process.argv.slice(2);
const dir = fileURLToPath(new URL('../../../content/questions', import.meta.url));
// npm runs workspace scripts inside admin/; resolve paths from where the command was typed.
const cwd = process.env.INIT_CWD ?? process.cwd();
const paths =
  args.length > 0
    ? args.map((a) => resolve(cwd, a))
    : readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => join(dir, f));

const files: ContentFile[] = paths.map((path) => ({
  name: path.split('/').pop() ?? path,
  data: JSON.parse(readFileSync(path, 'utf8')) as unknown,
}));

const runner = new WorkerSandboxRunner();
const validator = new ContentValidator(
  new QuestionTester(new VariantBuilder(builtInDatasets), new Grader(runner)),
);
const started = Date.now();
const report = await validator.validate(files);
await runner.close();

for (const p of report.problems) {
  console.log(`${p.level === 'error' ? '✗' : '!'} ${p.file} ${p.slug ?? ''}: ${p.message}`);
}
const errors = report.problems.filter((p) => p.level === 'error').length;
const tiers = Object.entries(report.byTier)
  .map(([t, n]) => `T${t}=${n}`)
  .join(' ');
console.log(
  `\n${report.questions} questions (${tiers}) in ${files.length} files — ${errors} errors, ` +
    `${report.problems.length - errors} warnings — ${((Date.now() - started) / 1000).toFixed(1)}s`,
);

// Coverage (docs/RCBSE.md §5.2): where the question set stands against the target profile.
const templates = files.flatMap((f) => {
  const list = Array.isArray(f.data)
    ? f.data
    : ((f.data as { questions?: unknown[] }).questions ?? []);
  return list.flatMap((raw) => {
    const parsed = questionTemplateSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
});
const coverage = coverageOf(templates);
console.log('\nRCSBE coverage (marks):');
for (const d of RCSBE_DIMENSIONS) {
  const t = coverage.byDimension[d];
  console.log(
    `  ${d} ${RCSBE_NAMES[d].padEnd(10)} ${String(t.items).padStart(4)} items ${String(t.marks).padStart(5)} marks`,
  );
}
console.log(
  'Bloom coverage (items): ' +
    BLOOM_LEVELS.map((b) => `${BLOOM_NAMES[b]} ${coverage.byBloom[b].items}`).join(' · '),
);
const gaps = shapeProblems(
  compareToTarget(coverage, DEFAULT_ANALYTICS_SETTINGS.targetProfile),
  RCSBE_NAMES,
);
if (gaps.length) console.log('Against the default target profile: ' + gaps.join('; ') + '.');

// Every tier has every RCSBE dimension and every Bloom level (Phase 17.13).
const enabled = templates.filter((t) => t.enabled);
const grid = coverageOf(enabled);
console.log('\nTier × RCSBE (questions):');
for (const t of [1, 2, 3, 4, 5])
  console.log(
    `  T${t} ` +
      RCSBE_DIMENSIONS.map((d) => `${d} ${String(grid.byTier[t]?.[d] ?? 0).padStart(3)}`).join(
        '  ',
      ),
  );
const holes = emptyCells(grid);
if (holes.length > 0) console.log(`✗ empty coverage cells: ${holes.join(', ')}`);

// Every topic a question uses has a concept card (Phase 16.1).
const cardTopics = new Set(
  conceptFileSchema
    .parse(
      JSON.parse(
        readFileSync(
          fileURLToPath(new URL('../../../content/concepts/cards.json', import.meta.url)),
          'utf8',
        ),
      ),
    )
    .cards.map((c) => c.topic),
);
const missingCards = [...new Set(templates.flatMap((t) => t.topic))].filter(
  (t) => !cardTopics.has(t),
);
if (missingCards.length > 0) {
  console.log(`✗ no concept card for topic(s): ${missingCards.join(', ')}`);
}
process.exit(errors > 0 || missingCards.length > 0 || holes.length > 0 ? 1 : 0);
