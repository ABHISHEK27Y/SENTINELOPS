import pino, { type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

export interface LoggerOptions {
  service: string;
  level?: string;
  /** Pretty-print in dev; JSON in prod. */
  pretty?: boolean;
}

/**
 * Creates a structured JSON logger. Every line carries `service`, timestamp,
 * level, and message. Trace/request ids are attached per-request via `child`.
 *
 * The output matches the log schema in the architecture doc:
 *   { timestamp, service, level, message, traceId, requestId, ... }
 */
export function createLogger(opts: LoggerOptions): Logger {
  const level = opts.level ?? process.env.LOG_LEVEL ?? 'info';
  const pretty =
    opts.pretty ?? (process.env.NODE_ENV !== 'production' && process.stdout.isTTY);

  return pino({
    level,
    base: { service: opts.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label.toUpperCase() };
      },
    },
    messageKey: 'message',
    // Never let secrets leak into logs.
    redact: {
      paths: [
        'password',
        'token',
        'authorization',
        'apiKey',
        'api_key',
        '*.password',
        '*.token',
        'headers.authorization',
      ],
      censor: '[REDACTED]',
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino/file',
            options: { destination: 1 },
          },
        }
      : {}),
  });
}

/** Attach request-scoped correlation fields. */
export function withRequestContext(
  logger: Logger,
  ctx: { requestId?: string; traceId?: string },
): Logger {
  return logger.child(ctx);
}
