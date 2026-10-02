import { useState } from 'react';
import { useImport } from '../api/questions';
import { ErrorMessage } from '../components/ErrorMessage';

export function ImportExportPage() {
  const importer = useImport();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [onConflict, setOnConflict] = useState<'skip' | 'update'>('skip');

  const isCsv = fileName
    ? fileName.toLowerCase().endsWith('.csv')
    : !text.trimStart().startsWith('{') && !text.trimStart().startsWith('[');

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setText(await file.text());
  }

  const report = importer.data;
  return (
    <div className="stack">
      <h1>Import / Export</h1>

      <div className="card stack">
        <h2>Export</h2>
        <p className="muted">
          Download every question (including disabled ones). JSON keeps everything; CSV opens in a
          spreadsheet and imports back losslessly.
        </p>
        <div className="row">
          <a href="/api/questions/export?format=json">
            <button>Download JSON</button>
          </a>
          <a href="/api/questions/export?format=csv">
            <button>Download CSV</button>
          </a>
        </div>
      </div>

      <div className="card stack">
        <h2>Import</h2>
        <label>
          File (.json or .csv)
          <input
            type="file"
            accept=".json,.csv,application/json,text/csv"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        <label>
          …or paste
          <textarea
            rows={8}
            value={text}
            onChange={(e) => {
              setFileName(null);
              setText(e.target.value);
            }}
            placeholder='{"questions": [ … ]}  or CSV with a header row'
          />
        </label>
        <div className="row">
          <label className="inline">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            Dry run (check only, save nothing)
          </label>
          <label>
            If a slug already exists
            <select
              value={onConflict}
              onChange={(e) => setOnConflict(e.target.value as 'skip' | 'update')}
            >
              <option value="skip">Skip it</option>
              <option value="update">Update it (new version)</option>
            </select>
          </label>
          <span className="spacer" />
          <span className="muted">Detected: {isCsv ? 'CSV' : 'JSON'}</span>
          <button
            className="primary"
            disabled={!text.trim() || importer.isPending}
            onClick={() => importer.mutate({ body: text, csv: isCsv, dryRun, onConflict })}
          >
            {importer.isPending ? 'Checking every question…' : dryRun ? 'Check import' : 'Import'}
          </button>
        </div>
      </div>

      <ErrorMessage error={importer.error} />

      {report && (
        <div className="card stack">
          <h2>{report.dryRun ? 'Dry-run result (nothing saved)' : 'Import result'}</h2>
          <div className="row">
            {(['created', 'updated', 'skipped', 'invalid'] as const).map((k) => (
              <span key={k} className={`badge ${k === 'invalid' && report.counts[k] ? 'off' : ''}`}>
                {report.dryRun && (k === 'created' || k === 'updated') ? `would be ${k}` : k}:{' '}
                {report.counts[k]}
              </span>
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Slug</th>
                  <th>Result</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((item) => (
                  <tr key={item.index}>
                    <td className="num">{item.index}</td>
                    <td>
                      <code>{item.slug ?? '—'}</code>
                    </td>
                    <td>
                      <span
                        className={`badge ${item.status === 'invalid' ? 'off' : item.status === 'skipped' ? 'warn' : 'ok'}`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td>{item.errors?.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
