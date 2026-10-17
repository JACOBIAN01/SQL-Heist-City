import { backup, restoreDrill } from './pgBackup';

const args = process.argv.slice(2);
const command = args[0];
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(2);
}
if (command === 'backup') {
  const r = backup({ url, outDir: arg('out', 'backups'), keep: Number(arg('keep', '14')) });
  console.log(
    `backup ${r.file} (${(r.bytes / 1e6).toFixed(2)} MB), ${r.pruned} old file(s) removed`,
  );
} else if (command === 'drill') {
  const out = arg('out', 'backups');
  const b = backup({ url, outDir: out, keep: Number(arg('keep', '14')) });
  const d = await restoreDrill({ url, file: b.file });
  console.log(
    `restore drill: ${b.file} → scratch database; ${d.tables} tables, ${d.rows} rows restored, ${d.mismatches.length} mismatches`,
  );
  for (const m of d.mismatches) console.log(`✗ ${m}`);
  process.exit(d.mismatches.length > 0 ? 1 : 0);
} else {
  console.error('usage: backup:pg backup|drill [--out dir] [--keep n]');
  process.exit(2);
}
