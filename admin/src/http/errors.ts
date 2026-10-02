import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, type ZodType } from 'zod';

/** An error meant for the API caller: status + stable code + safe message. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const forbidden = () => new HttpError(403, 'forbidden', 'You are not allowed to do that');
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Please log in');
export const conflict = (message: string) => new HttpError(409, 'conflict', message);

/** Parses untrusted input with a shared zod schema; failures become 400s. */
export function parse<S extends ZodType>(schema: S, input: unknown): S['_output'] {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function validationError(error: ZodError): HttpError {
  return new HttpError(
    400,
    'validation_failed',
    'Some fields are invalid',
    error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

export const apiNotFound: RequestHandler = (_req, _res, next) => next(notFound('Route'));

export interface ErrorLogger {
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Last middleware: every error leaves as `{ error: { code, message, details? } }`. */
export function errorHandler(logger: ErrorLogger): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    let http: HttpError;
    if (err instanceof HttpError) http = err;
    else if (err instanceof ZodError) http = validationError(err);
    else if (isBodyParserError(err))
      http = new HttpError(400, 'bad_request', 'Malformed request body');
    else {
      // Unknown errors may contain internals; log them, return a generic message.
      logger.error('unhandled admin API error', {
        method: req.method,
        path: req.path,
        error: err instanceof Error ? err.stack : String(err),
      });
      http = new HttpError(500, 'internal', 'Something went wrong');
    }
    res.status(http.status).json({
      error: {
        code: http.code,
        message: http.message,
        ...(http.details === undefined ? {} : { details: http.details }),
      },
    });
  };
}

function isBodyParserError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    'status' in err &&
    (err as { status: number }).status === 400
  );
}
