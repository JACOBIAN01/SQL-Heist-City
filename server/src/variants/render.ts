import { PLACEHOLDER_PATTERN } from '@heist/shared';
import type { ParamValue, ResolvedParams } from './params';

/** SQL literal for a param value. Strings are quoted with '' escaping. */
export function sqlLiteral(value: ParamValue): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${value.replaceAll("'", "''")}'`;
}

function plain(value: ParamValue): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/**
 * Substitutes `{name}` (plain text) and `{name|sql}` (SQL literal).
 * Unknown names are a bug: the schema guarantees every placeholder has a param.
 */
export function renderTemplate(text: string, params: ResolvedParams): string {
  return text.replace(PLACEHOLDER_PATTERN, (_match, name: string, format?: string) => {
    if (!(name in params)) throw new Error(`no value for placeholder {${name}}`);
    const value = params[name] as ParamValue;
    return format === 'sql' ? sqlLiteral(value) : plain(value);
  });
}
