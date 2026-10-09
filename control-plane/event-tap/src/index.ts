/**
 * event-tap — a diagnostic consumer that subscribes to every topic and reports
 * a running count of events by topic and type. It proves the Kafka pipeline is
 * actually transporting data and is invaluable for debugging the control plane.
 */
import { EventConsumer } from '@sentinelops/kafka';
import { Topics } from '@sentinelops/shared-types';
import { createLogger } from '@sentinelops/logger';

const log = createLogger({ service: 'event-tap' });

const counts = new Map<string, number>();
const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);

const consumer = new EventConsumer({ groupId: 'event-tap' });

async function main(): Promise<void> {
  await consumer.run({
    topics: [
      Topics.telemetry,
      Topics.metrics,
      Topics.logs,
      Topics.anomaly,
      Topics.incident,
      Topics.remediation,
      Topics.recovery,
      Topics.deadletter,
    ],
    fromBeginning: false,
    handler: async (envelope, ctx) => {
      bump(`${ctx.topic}`);
      bump(`${ctx.topic}#${envelope.type}`);
    },
  });

  setInterval(() => {
    const summary = [...counts.entries()]
      .filter(([k]) => !k.includes('#'))
      .map(([topic, n]) => `${topic}=${n}`)
      .join(' ');
    log.info({ summary: summary || '(none yet)' }, 'event-tap totals');
  }, 5000).unref();
}

main().catch((err) => {
  log.error({ err: (err as Error).message }, 'event-tap failed');
  process.exit(1);
});

function shutdown(signal: string) {
  log.info({ signal }, 'stopping event-tap');
  void consumer.stop().finally(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
