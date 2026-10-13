import { afterEach, expect, it, vi } from 'vitest';

const emit = vi.hoisted(() => vi.fn());
vi.mock('@opentelemetry/api-logs', async importOriginal => {
  const actual = await importOriginal<typeof import('@opentelemetry/api-logs')>();
  return { ...actual, logs: { getLogger: () => ({ emit }) } };
});
import { createLogger, withRequestContext } from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
  emit.mockReset();
});
it('exports redacted structured records and preserves child context and debug severity', () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const logger = withRequestContext(
    createLogger({ service: 'log-acceptance', pretty: false, level: 'debug' }),
    { requestId: 'request-1' }
  );
  logger.debug(
    { password: 'never-export-this', headers: { authorization: 'secret-token' } },
    'sample'
  );
  expect(emit).toHaveBeenCalledTimes(1);
  const record = emit.mock.calls[0]![0];
  expect(record.severityText).toBe('DEBUG');
  expect(record.body).toContain('request-1');
  expect(record.body).toContain('[REDACTED]');
  expect(record.body).not.toContain('never-export-this');
  expect(record.body).not.toContain('secret-token');
});
it('continues logging if the telemetry exporter throws', () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  emit.mockImplementationOnce(() => {
    throw new Error('collector unavailable');
  });
  expect(() =>
    createLogger({ service: 'log-acceptance', pretty: false }).info('sample')
  ).not.toThrow();
});
