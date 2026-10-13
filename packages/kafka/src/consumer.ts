import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';

import { createLogger, type Logger } from '@sentinelops/logger';
import {
  EventEnvelopeSchema,
  Topics,
  type EventEnvelope,
  type TopicName,
} from '@sentinelops/shared-types';

import {
  backoffDelay,
  shouldRetry,
  sleep,
  type BackoffOptions,
  DEFAULT_BACKOFF,
} from './backoff.js';
import { createKafka } from './client.js';
import { InMemoryIdempotencyStore, type IdempotencyStore } from './idempotency.js';
import { EventProducer } from './producer.js';

export type EventHandler = (
  envelope: EventEnvelope,
  ctx: { topic: string; partition: number; attempt: number }
) => Promise<void>;

export interface EventConsumerOptions {
  groupId: string;
  kafka?: Kafka;
  idempotency?: IdempotencyStore;
  /** Producer used to publish to the dead-letter topic. */
  dlqProducer?: EventProducer;
  backoff?: BackoffOptions;
  logger?: Logger;
}

/**
 * At-least-once consumer with per-message in-process retry (jittered backoff),
 * idempotent skipping of redelivered events, and a dead-letter topic for poison
 * messages. Offsets commit only after a message is handled or dead-lettered, so
 * nothing is silently dropped.
 */
export class EventConsumer {
  private consumer: Consumer;
  private idempotency: IdempotencyStore;
  private dlq: EventProducer;
  private backoff: BackoffOptions;
  private log: Logger;
  private active = false;
  get isRunning(): boolean {
    return this.active;
  }

  constructor(private opts: EventConsumerOptions) {
    const kafka = opts.kafka ?? createKafka();
    this.consumer = kafka.consumer({ groupId: opts.groupId });
    if (this.consumer.events) {
      this.consumer.on(this.consumer.events.GROUP_JOIN, () => {
        this.active = true;
      });
      for (const event of [
        this.consumer.events.STOP,
        this.consumer.events.CRASH,
        this.consumer.events.DISCONNECT,
      ]) {
        this.consumer.on(event, () => {
          this.active = false;
        });
      }
    }
    this.idempotency = opts.idempotency ?? new InMemoryIdempotencyStore();
    this.dlq = opts.dlqProducer ?? new EventProducer({ kafka, strict: true });
    this.backoff = opts.backoff ?? DEFAULT_BACKOFF;
    this.log = opts.logger ?? createLogger({ service: `consumer:${opts.groupId}` });
  }

  async run(params: {
    topics: TopicName[];
    handler: EventHandler;
    fromBeginning?: boolean;
  }): Promise<void> {
    await this.consumer.connect();
    await this.dlq.connect();
    await this.consumer.subscribe({
      topics: params.topics,
      fromBeginning: params.fromBeginning ?? false,
    });
    this.log.info({ topics: params.topics, group: this.opts.groupId }, 'consumer running');

    await this.consumer.run({
      eachMessage: payload => this.handleMessage(payload, params.handler),
    });
    this.active = true;
  }

  private async handleMessage(
    { topic, partition, message }: EachMessagePayload,
    handler: EventHandler
  ): Promise<void> {
    const raw = message.value?.toString();
    if (!raw) return;

    // 1. Validate the envelope. Malformed → dead-letter immediately.
    let envelope: EventEnvelope;
    try {
      envelope = EventEnvelopeSchema.parse(JSON.parse(raw)) as EventEnvelope;
    } catch (err) {
      await this.deadLetter(topic, raw, `invalid envelope: ${(err as Error).message}`);
      return;
    }

    // 2. Idempotency: skip events already processed (redelivery).
    if (await this.idempotency.hasProcessed(envelope.eventId)) {
      this.log.debug({ eventId: envelope.eventId, topic }, 'duplicate skipped');
      return;
    }

    // 3. Process with in-process retries + jittered backoff.
    let attempt = 0;
    for (;;) {
      try {
        await handler(envelope, { topic, partition, attempt });
        await this.idempotency.markProcessed(envelope.eventId);
        return;
      } catch (err) {
        const msg = (err as Error).message;
        if (shouldRetry(attempt, this.backoff)) {
          const delay = backoffDelay(attempt, this.backoff);
          this.log.warn(
            { eventId: envelope.eventId, topic, attempt, delay, err: msg },
            'handler failed, retrying'
          );
          await sleep(delay);
          attempt += 1;
          continue;
        }
        // 4. Exhausted retries → dead-letter and move on (offset commits).
        await this.deadLetter(topic, raw, `handler failed after retries: ${msg}`);
        await this.idempotency.markProcessed(envelope.eventId);
        return;
      }
    }
  }

  private async deadLetter(originalTopic: string, raw: string, reason: string): Promise<void> {
    this.log.error({ originalTopic, reason }, 'dead-lettering message');
    const delivered = await this.dlq.send(Topics.deadletter, {
      eventId: crypto.randomUUID(),
      type: 'DEAD_LETTER',
      timestamp: new Date().toISOString(),
      service: `consumer:${this.opts.groupId}`,
      version: 1,
      payload: { originalTopic, reason, original: raw },
    });
    if (!delivered) throw new Error('dead-letter delivery failed; message must be redelivered');
  }

  async stop(): Promise<void> {
    this.active = false;
    try {
      await this.consumer.disconnect();
      if (!this.opts.dlqProducer) await this.dlq.disconnect();
      await this.idempotency.close?.();
    } catch {
      /* ignore */
    }
  }
}
