import { logs, SeverityNumber } from '@opentelemetry/api-logs';
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
  const level = opts.level ?? process.env['LOG_LEVEL'] ?? 'info';
  const pretty = opts.pretty ?? (process.env['NODE_ENV'] !== 'production' && process.stdout.isTTY);

  const exporter = logs.getLogger('sentinelops.logger');
  const stream = pino.multistream([
    { level: 'trace', stream: process.stdout },
    {
      level: 'trace',
      stream: {
        write(line: string) {
          try {
            // Pino serializes and redacts before this sink receives the record.
            const record = JSON.parse(line) as { level: string; message?: string; service: string };
            const severity = {
              TRACE: SeverityNumber.TRACE,
              DEBUG: SeverityNumber.DEBUG,
              INFO: SeverityNumber.INFO,
              WARN: SeverityNumber.WARN,
              ERROR: SeverityNumber.ERROR,
              FATAL: SeverityNumber.FATAL,
            };
            exporter.emit({
              body: line.trim(),
              severityText: record.level,
              severityNumber:
                severity[record.level as keyof typeof severity] ?? SeverityNumber.INFO,
              attributes: { 'service.name': record.service },
            });
          } catch {
            /* Observability must not interrupt application logging. */
          }
        },
      },
    },
  ]);
  return pino(
    {
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
    },
    pretty ? undefined : stream
  );
}

/** Attach request-scoped correlation fields. */
export function withRequestContext(
  logger: Logger,
  ctx: { requestId?: string; traceId?: string }
): Logger {
  return logger.child(ctx);
}
