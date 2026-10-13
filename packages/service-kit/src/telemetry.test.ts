import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const otel = vi.hoisted(() => ({
  options: null as null | Record<string, unknown>,
  start: vi.fn(),
  shutdown: vi.fn(),
  endpoints: [] as string[],
}));
vi.mock('@sentinelops/config', () => ({
  getEnv: () => ({
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
    OTEL_SERVICE_NAMESPACE: 'demo',
    NODE_ENV: 'test',
  }),
}));
vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class {
    constructor(options: Record<string, unknown>) {
      otel.options = options;
    }
    start = otel.start;
    shutdown = otel.shutdown;
  },
}));
vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: () => ['instrumentations'],
}));
vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: (attributes: object) => ({ attributes }),
}));
vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {
    constructor(options: { url: string }) {
      otel.endpoints.push(options.url);
    }
  },
}));
vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  OTLPMetricExporter: class {
    constructor(options: { url: string }) {
      otel.endpoints.push(options.url);
    }
  },
}));
vi.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  OTLPLogExporter: class {
    constructor(options: { url: string }) {
      otel.endpoints.push(options.url);
    }
  },
}));
vi.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: class {
    constructor(readonly options: object) {}
  },
}));
vi.mock('@opentelemetry/sdk-logs', () => ({
  BatchLogRecordProcessor: class {
    constructor(readonly options: { exporter: object }) {}
  },
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  otel.endpoints = [];
  otel.options = null;
  otel.start.mockImplementation(() => {});
  otel.shutdown.mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe('OTLP bootstrap', () => {
  it('initializes traces, metrics and log sending once and shuts down once', async () => {
    const { startTelemetry, stopTelemetry } = await import('./telemetry.js');
    await startTelemetry('payment-service');
    await startTelemetry('payment-service');
    expect(otel.endpoints.sort()).toEqual([
      'http://collector:4318/v1/logs',
      'http://collector:4318/v1/metrics',
      'http://collector:4318/v1/traces',
    ]);
    expect(otel.options?.['logRecordProcessors']).toHaveLength(1);
    expect(otel.start).toHaveBeenCalledOnce();
    await stopTelemetry();
    await stopTelemetry();
    expect(otel.shutdown).toHaveBeenCalledOnce();
  });
  it('allows services to boot when telemetry initialization fails', async () => {
    otel.start.mockImplementation(() => {
      throw new Error('collector bootstrap failed');
    });
    const { startTelemetry, stopTelemetry } = await import('./telemetry.js');
    await expect(startTelemetry('payment-service')).resolves.toBeUndefined();
    await stopTelemetry();
    expect(otel.shutdown).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('disabled'));
  });
  it('tolerates an exporter shutdown failure', async () => {
    otel.shutdown.mockRejectedValue(new Error('offline'));
    const { startTelemetry, stopTelemetry } = await import('./telemetry.js');
    await startTelemetry('payment-service');
    await expect(stopTelemetry()).resolves.toBeUndefined();
  });
});
