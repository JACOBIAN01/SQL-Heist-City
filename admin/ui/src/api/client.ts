/** Error returned by the admin API: `{ error: { code, message, details? } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  /** Send `body` as-is with this content type (e.g. CSV import). */
  readonly rawContentType?: string;
}

/**
 * Thin fetch wrapper for /api. Sends the CSRF header the server requires and
 * turns error responses into ApiError so UI code can show `message` and
 * per-field `details`.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, rawContentType } = options;
  const headers: Record<string, string> = { 'x-heist-admin': '1' };
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['content-type'] = rawContentType ?? 'application/json';
    payload = rawContentType ? (body as string) : JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(payload === undefined ? {} : { body: payload }),
  });
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get('content-type')?.includes('json') ?? false;
  const data: unknown = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'http_error',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  return data as T;
}
