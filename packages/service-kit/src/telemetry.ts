/**
 * OpenTelemetry bootstrap. Must be started BEFORE the app imports libraries it
 * wants auto-instrumented (http, fastify, pg, redis, kafkajs). Services do this
 * by importing this module first (see each service's `instrument.ts`).
 *
 * Robustness: if the collector is unreachable or an OTel package is missing, we
 * log and continue. Observability is best-effort; the service must still boot.
 * Prometheus /metrics (prom-client) is the always-available metrics path.
 */
import { getEnv } from '@sentinelops/config';

let started = false;
let shutdownFn: (() => Promise<void>) | null = null;

export async function startTelemetry(serviceName: string): Promise<void> {
  if (started) return;
  started = true;
  const env = getEnv();

  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } =
      await import('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
    const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics');
    const { Resource } = await import('@opentelemetry/resources');

    const resource = new Resource({
      'service.name': serviceName,
      'service.namespace': env.OTEL_SERVICE_NAMESPACE,
      'deployment.environment': env.NODE_ENV,
    });

    const traceExporter = new OTLPTraceExporter({
      url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
    });
    const metricReader = new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics`,
      }),
      exportIntervalMillis: 10_000,
    });

    const sdk = new NodeSDK({
      resource,
      traceExporter,
      metricReader,
      instrumentations: [
        getNodeAutoInstrumentations({
          // fs instrumentation is noisy; disable it.
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    sdk.start();
    shutdownFn = async () => {
      await sdk.shutdown();
    };
    console.log(`[otel] telemetry started for ${serviceName}`);
  } catch (err) {
    console.warn(`[otel] telemetry disabled for ${serviceName}: ${(err as Error).message}`);
  }
}

export async function stopTelemetry(): Promise<void> {
  if (shutdownFn) {
    try {
      await shutdownFn();
    } catch {
      /* ignore */
    }
  }
}
