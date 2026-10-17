/**
 * Structured logging (Phase 20.4): one JSON object per line on stdout (errors on stderr), so a
 * log collector can search by field. `LOG_LEVEL` (debug|info|warn|error, default info) sets the
 * floor; `SERVICE_NAME` says which service wrote the line. Anything that looks like a secret is
 * replaced before it is written, and reference SQL is never logged at info.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** The same logger with fields added to every line. */
  child(fields: Record<string, unknown>): Logger;
}

const SECRET_KEY = /secret|password|token|ticket|cookie|authorization|api[_-]?key|reference_?sql/i;

/** A value fit for a log line: errors become {name, message, stack}, secret-looking keys are hidden. */
export function loggable(value: unknown, depth = 0): unknown {
  if (value instanceof Error)
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.split('\n').slice(0, 6).join('\n'),
    };
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= 4) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => loggable(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      SECRET_KEY.test(k) ? '[redacted]' : loggable(v, depth + 1),
    ]),
  );
}

export interface LoggerOptions {
  readonly service?: string;
  readonly level?: LogLevel;
  readonly now?: () => Date;
  /** Where lines go; default stdout, or stderr for errors. */
  readonly write?: (line: string, level: LogLevel) => void;
}

const defaultWrite = (line: string, level: LogLevel) =>
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);

export function createLogger(
  options: LoggerOptions = {},
  base: Record<string, unknown> = {},
): Logger {
  const floor =
    ORDER[options.level ?? (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info'] ?? ORDER.info;
  const write = options.write ?? defaultWrite;
  const now = options.now ?? (() => new Date());
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < floor) return;
    write(
      JSON.stringify({
        time: now().toISOString(),
        level,
        service: options.service ?? process.env.SERVICE_NAME ?? 'heist',
        msg,
        ...(loggable({ ...base, ...fields }) as object),
      }),
      level,
    );
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createLogger(options, { ...base, ...fields }),
  };
}

/** The process-wide logger. */
export const log = createLogger();

/**
 * Writes what crashes the process as a log line first (a collector then sees it), and lets a
 * rejected promise nobody handled stop the process the way Node does by default.
 */
export function installCrashLogging(logger: Logger = log): void {
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception', { err });
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    logger.error('unhandled rejection', { err });
    process.exit(1);
  });
}
