import { ApiError } from '../api/client';

/** Shows an API error's message and, for validation errors, each field problem. */
export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const details =
    error instanceof ApiError && Array.isArray(error.details)
      ? (error.details as {
          path?: string;
          message?: string;
          seed?: string;
          error?: string | null;
        }[])
      : [];
  return (
    <div className="error" role="alert">
      <strong>{message}</strong>
      {details.length > 0 && (
        <ul>
          {details.slice(0, 10).map((d, i) => (
            <li key={i}>
              {d.path !== undefined && <code>{d.path || '(root)'}</code>}{' '}
              {d.seed !== undefined && <code>{d.seed}</code>} {d.message ?? d.error ?? ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
