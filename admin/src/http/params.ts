import { HttpError } from './errors';

/** Parses a positive integer route param like `/questions/:id`. */
export function idParam(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'bad_id', 'Invalid id');
  return id;
}
