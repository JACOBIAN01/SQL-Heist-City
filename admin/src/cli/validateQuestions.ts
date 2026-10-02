import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const paths =
  args.length > 0
    ? args
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
process.exit(errors > 0 ? 1 : 0);
