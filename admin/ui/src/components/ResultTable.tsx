type Cell = string | number | null;

/** Small read-only table for SQL results and sample data. */
export function ResultTable({
  columns,
  rows,
  max = 50,
}: {
  columns: readonly string[];
  rows: readonly (readonly Cell[])[];
  max?: number;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={typeof v === 'number' ? 'num' : undefined}>
                  {v === null ? <span className="muted">NULL</span> : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="muted">…and {rows.length - max} more rows</p>}
    </div>
  );
}
