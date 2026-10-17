import { z } from 'zod';

/**
 * An error that happened in a student's browser (Phase 20.5). Deliberately small and free of
 * personal data: no name, no account, no tickets, no query strings.
 */
export const clientErrorSchema = z.object({
  message: z.string().max(500),
  stack: z.string().max(2000).optional(),
  source: z.enum(['error', 'unhandledrejection']),
  /** Which page of the app (the path only, e.g. `/` or `/sql-demo.html`). */
  page: z.string().max(100),
  userAgent: z.string().max(300).optional(),
});
export type ClientError = z.infer<typeof clientErrorSchema>;

/** Where an error report goes, on the game server. */
export const CLIENT_ERROR_PATH = '/client-error';

/**
 * Removes what must not leave the browser from an error's text: query strings and fragments of
 * URLs (a page address can carry a class id or a sign-in return), and ticket-like values.
 */
export function scrubErrorText(text: string): string {
  return text
    .replace(/(https?:\/\/[^\s)?#]+)[?#][^\s):]*/g, '$1')
    .replace(/\b(ticket|token|code|state|secret|password)=[^&\s)]+/gi, '$1=[redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[email]');
}

/** A report with its text scrubbed. The server does this too: the sender cannot be trusted to have. */
export function scrubClientError(report: ClientError): ClientError {
  return {
    ...report,
    message: scrubErrorText(report.message),
    ...(report.stack === undefined ? {} : { stack: scrubErrorText(report.stack) }),
    page: scrubErrorText(report.page),
  };
}
