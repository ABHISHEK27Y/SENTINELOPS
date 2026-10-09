import { Kafka, logLevel, type KafkaConfig } from 'kafkajs';

import { getEnv, kafkaBrokers } from '@sentinelops/config';

/**
 * Builds a configured KafkaJS client. Brokers and client id come from validated
 * env ([config]). KafkaJS's own logging is quieted; we log through pino instead.
 */
export function createKafka(overrides: Partial<KafkaConfig> = {}): Kafka {
  const env = getEnv();
  return new Kafka({
    clientId: env.KAFKA_CLIENT_ID,
    brokers: kafkaBrokers(env),
    logLevel: logLevel.NOTHING,
    retry: { retries: 5, initialRetryTime: 300 },
    ...overrides,
  });
}
